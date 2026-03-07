// controllers/subscription/onboardingController.js
// Lightweight onboard endpoint — Enterprise Pattern
// Creates Stripe Checkout ONLY. Tenant creation happens in webhook after payment.

const PlanTemplate = require('../../models/PlanTemplate');
const TenantSubscription = require('../../models/TenantSubscription');
const Tenant = require('../../models/Tenant');
const User = require('../../models/User');
const mongoose = require('mongoose');
const subscriptionManager = require('../../services/subscription/subscriptionManager');
const featureFlagManager = require('../../services/subscription/featureFlagManager');
const getBaseURL = require('../../utils/getBaseURL');

/**
 * @desc Onboard a user to a plan — creates Stripe checkout (or provisions free plan)
 * @route POST /api/subscriptions/onboard
 * @access Private (any authenticated user)
 */
exports.onboardAndCheckout = async (req, res) => {
    try {
        const { planCode, billingCycle = 'monthly' } = req.body;
        const user = req.user;

        // ─── Validation ───
        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'planCode is required'
            });
        }

        if (!['monthly', 'yearly'].includes(billingCycle)) {
            return res.status(400).json({
                success: false,
                message: 'billingCycle must be monthly or yearly'
            });
        }

        // ─── Fetch plan from DB (never trust frontend pricing) ───
        const plan = await PlanTemplate.getByCode(planCode);
        if (!plan) {
            return res.status(404).json({
                success: false,
                message: `Plan not found: ${planCode}`
            });
        }

        if (!plan.isActive) {
            return res.status(400).json({
                success: false,
                message: 'This plan is no longer available'
            });
        }

        // ─── Guard: Already has active subscription ───
        if (user.tenant) {
            const existingSubscription = await TenantSubscription.findOne({ tenant: user.tenant });
            if (existingSubscription && existingSubscription.billing.status === 'active') {
                // Redirect to billing portal instead
                try {
                    const portalResult = await subscriptionManager.createBillingPortalSession(
                        user.tenant,
                        `${process.env.ADMIN_URL_LOCAL || process.env.ADMIN_URL_PROD}/app/subscription/my-plan`
                    );
                    return res.status(200).json({
                        success: true,
                        action: 'billing_portal',
                        url: portalResult.url
                    });
                } catch (portalError) {
                    return res.status(400).json({
                        success: false,
                        message: 'You already have an active subscription. Please manage it from your dashboard.'
                    });
                }
            }
        }

        // ─── Guard: Pending checkout (full idempotency with Stripe session check) ───
        if (user.pendingCheckoutSessionId) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                const existingSession = await stripe.checkout.sessions.retrieve(user.pendingCheckoutSessionId);

                if (existingSession.status === 'open') {
                    // Session still active → return existing URL (prevents multi-tab duplication)
                    return res.status(200).json({
                        success: true,
                        action: 'checkout',
                        message: 'Checkout session already in progress',
                        sessionId: existingSession.id,
                        url: existingSession.url
                    });
                }

                // Session expired or completed → clear cache, proceed to create new session
                user.pendingCheckoutSessionId = null;
                await user.save();
            } catch (stripeErr) {
                // Session retrieval failed → clear cache, proceed
                console.warn('⚠️ Failed to retrieve pending session, clearing:', stripeErr.message);
                user.pendingCheckoutSessionId = null;
                await user.save();
            }
        }

        // ─── Determine flow: Free vs Paid ───
        const price = billingCycle === 'yearly' ? plan.pricing.yearly : plan.pricing.monthly;

        if (price === 0) {
            // ─── FREE PLAN: Provision immediately (atomic transaction) ───
            return await _handleFreePlan(req, res, user, plan);
        }

        // ─── PAID PLAN: Create Stripe Checkout Session only ───
        return await _handlePaidPlan(req, res, user, plan, billingCycle);

    } catch (error) {
        console.error('❌ onboardAndCheckout error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to start onboarding'
        });
    }
};


/**
 * Handle free plan: create Tenant + TenantSubscription atomically
 */
async function _handleFreePlan(req, res, user, plan) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Create Tenant
        const tenant = await Tenant.create([{
            admin: user._id,
            name: `${user.name}'s Organization`,
            contactEmail: user.email
        }], { session });

        const tenantDoc = tenant[0];

        // Promote user to companyAdmin
        user.role = 'companyAdmin';
        user.tenant = tenantDoc._id;
        user.companyProfileUpdated = false;
        await user.save({ session });

        // Create TenantSubscription
        const subscription = await TenantSubscription.create([{
            tenant: tenantDoc._id,
            planTemplate: plan._id,
            planCode: plan.code,
            billing: {
                cycle: 'monthly',
                status: 'active'
            },
            onboardingStatus: 'awaiting_setup',
            createdBy: user._id
        }], { session });

        // Apply plan features
        const subDoc = subscription[0];
        await subDoc.applyPlanFeatures(plan);

        await session.commitTransaction();

        console.log(`✅ Free plan provisioned for user ${user._id} → tenant ${tenantDoc._id}`);

        res.status(200).json({
            success: true,
            action: 'subscribed',
            message: 'Free plan activated successfully',
            redirectUrl: '/app/onboarding'
        });
    } catch (error) {
        await session.abortTransaction();
        console.error('❌ Free plan provisioning failed:', error.message);
        throw error;
    } finally {
        session.endSession();
    }
}


/**
 * Handle paid plan: create Stripe Checkout Session (no DB records until webhook)
 */
async function _handlePaidPlan(req, res, user, plan, billingCycle) {
    const priceId = billingCycle === 'yearly'
        ? plan.stripe?.yearlyPriceId
        : plan.stripe?.monthlyPriceId;

    if (!priceId) {
        return res.status(400).json({
            success: false,
            message: `Stripe price not configured for plan "${plan.code}" (${billingCycle})`
        });
    }

    // Create Stripe Customer using user's email (no tenant yet)
    const gateway = subscriptionManager.gateway;
    const customerResult = await gateway.createCustomer({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() }
    });

    const publicUrl = getBaseURL().public;

    // Create Checkout Session with metadata for webhook provisioning
    const sessionResult = await gateway.createCheckoutSession(
        customerResult.customerId,
        priceId,
        {
            successUrl: `${publicUrl}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${publicUrl}/pricing`,
            trialDays: plan.trial?.enabled ? plan.trial.days : 0,
            metadata: {
                userId: user._id.toString(),
                planCode: plan.code,
                billingCycle: billingCycle,
                stripeCustomerId: customerResult.customerId
            }
        }
    );

    // Cache session ID for idempotency guard
    user.pendingCheckoutSessionId = sessionResult.sessionId;
    await user.save();

    console.log(`✅ Checkout session created for user ${user._id}: ${sessionResult.sessionId}`);

    res.status(200).json({
        success: true,
        action: 'checkout',
        sessionId: sessionResult.sessionId,
        url: sessionResult.url
    });
}
