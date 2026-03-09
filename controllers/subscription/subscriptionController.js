// controllers/subscription/subscriptionController.js
// Subscription management API endpoints

const subscriptionManager = require('../../services/subscription/subscriptionManager');
const featureFlagManager = require('../../services/subscription/featureFlagManager');
const usageLimitsService = require('../../services/subscription/usageLimitsService');
const PlanTemplate = require('../../models/PlanTemplate');
const TenantSubscription = require('../../models/TenantSubscription');
const User = require('../../models/User');
const getBaseURL = require('../../utils/getBaseURL');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * @desc Check subscription provisioning status via Stripe session ID
 * @route GET /api/subscriptions/status?session_id=XYZ
 * @access Public (no auth — used by public checkout-success page)
 */
exports.getSubscriptionStatus = async (req, res) => {
    try {
        const { session_id } = req.query;

        if (!session_id) {
            return res.status(400).json({
                success: false,
                message: 'session_id is required'
            });
        }

        // Retrieve session from Stripe to get userId from metadata
        let session;
        try {
            session = await stripe.checkout.sessions.retrieve(session_id);
        } catch (stripeErr) {
            console.error('[status] Stripe session retrieve failed:', stripeErr.message);
            return res.status(404).json({
                success: false,
                message: 'Invalid or expired session'
            });
        }

        const userId = session.metadata?.userId;
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'Session missing user metadata'
            });
        }

        console.log(`[status] Checking provisioning: userId=${userId}, payment_status=${session.payment_status}`);

        const user = await User.findById(userId).select('tenant role pendingCheckoutSessionId');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if provisioning is complete
        if (user.tenant && user.role === 'companyAdmin') {
            const sub = await TenantSubscription.findOne({ tenant: user.tenant });
            if (sub && sub.billing.status === 'active') {
                const adminUrl = getBaseURL().admin;
                console.log(`[status] ✅ Already provisioned: userId=${userId}, tenant=${user.tenant}`);
                return res.status(200).json({
                    success: true,
                    provisioned: true,
                    adminUrl: `${adminUrl}/login`,
                    message: 'Your workspace is ready!'
                });
            }
        }

        // Payment confirmed but webhook hasn't provisioned yet — trigger fallback provisioning
        if (session.payment_status === 'paid') {
            console.log(`[status] ⚡ Payment confirmed but not provisioned. Triggering fallback provisioning for userId=${userId}`);
            try {
                const eventData = {
                    id: session.id,
                    customer: session.customer,
                    subscription: session.subscription,
                    metadata: session.metadata
                };

                await subscriptionManager._handleCheckoutCompleted(eventData, null);

                // Re-check after provisioning
                const freshUser = await User.findById(userId).select('tenant role');
                if (freshUser?.tenant && freshUser?.role === 'companyAdmin') {
                    const adminUrl = getBaseURL().admin;
                    console.log(`[status] ✅ Fallback provisioning successful: userId=${userId}`);
                    return res.status(200).json({
                        success: true,
                        provisioned: true,
                        adminUrl: `${adminUrl}/login`,
                        message: 'Your workspace is ready!'
                    });
                }
            } catch (provisionError) {
                console.error('[status] ⚠️ Fallback provisioning failed:', provisionError.message);
                // Don't fail the response — just report not provisioned yet
            }
        }

        // Not yet provisioned
        return res.status(200).json({
            success: true,
            provisioned: false,
            paymentStatus: session.payment_status,
            message: 'Provisioning in progress...'
        });

    } catch (error) {
        console.error('❌ getSubscriptionStatus error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to check status'
        });
    }
};

/**
 * @desc Get all public plans for pricing page
 * @route GET /api/subscriptions/plans
 * @access Public
 */
exports.getPublicPlans = async (req, res) => {
    try {
        const plans = await PlanTemplate.getPublicPlans();

        // Get feature definitions for display
        const featureDefinitions = await featureFlagManager.getAllFeatureDefinitions();
        const featureMap = {};
        featureDefinitions.forEach(f => {
            featureMap[f.code] = {
                name: f.name,
                description: f.description || null,
                category: f.category,
                type: f.type,
                unit: f.unit,
                isPublic: f.isPublic !== false,  // default true
                displayOrder: f.displayOrder || 0,
                icon: f.metadata?.icon || null,
                tooltip: f.metadata?.tooltip || null
            };
        });

        res.status(200).json({
            success: true,
            data: {
                plans,
                featureDefinitions: featureMap
            }
        });
    } catch (error) {
        console.error('❌ getPublicPlans error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plans'
        });
    }
};

/**
 * @desc Get current tenant's subscription
 * @route GET /api/subscriptions/current
 * @access Private
 */
exports.getCurrentSubscription = async (req, res) => {
    try {
        const tenantId = req.user.tenant;

        // User may not have a tenant yet (webhook hasn't fired after payment)
        if (!tenantId) {
            return res.status(200).json({
                success: true,
                data: null,
                message: 'No tenant provisioned yet'
            });
        }

        const subscriptionData = await featureFlagManager.getTenantFeatures(tenantId);
        const usageReport = await usageLimitsService.getUsageReport(tenantId);

        res.status(200).json({
            success: true,
            data: {
                ...subscriptionData,
                usage: usageReport.limits
            }
        });
    } catch (error) {
        console.error('❌ getCurrentSubscription error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription'
        });
    }
};

/**
 * @desc Get complete "My Plan" data — current plan, billing, upgrades, usage in one call
 * @route GET /api/subscriptions/my-plan
 * @access Private (Company Admin)
 */
exports.getMyPlan = async (req, res) => {
    try {
        const tenantId = req.user.tenant;

        if (!tenantId) {
            return res.status(200).json({
                success: true,
                data: null,
                message: 'No tenant provisioned yet'
            });
        }

        // Fetch subscription with populated plan template
        const subscription = await TenantSubscription.findOne({ tenant: tenantId })
            .populate('planTemplate');

        if (!subscription) {
            return res.status(200).json({
                success: true,
                data: null,
                message: 'No subscription found'
            });
        }

        // Get current plan details
        const currentPlan = subscription.planTemplate;

        // Get all active plans for upgrade comparison (sorted by displayOrder)
        const allPlans = await PlanTemplate.find({ isActive: true })
            .sort({ displayOrder: 1 })
            .select('-stripe -tap -createdBy');

        // Determine current plan index for upgrade/downgrade detection
        const currentPlanIndex = allPlans.findIndex(p => p.code === subscription.planCode);

        // Build available upgrade plans (only higher-tier)
        const upgradePlans = allPlans
            .filter((p, idx) => idx > currentPlanIndex && p.isPublic)
            .map(p => ({
                _id: p._id,
                code: p.code,
                name: p.name,
                description: p.description,
                pricing: p.pricing,
                badge: p.badge,
                features: p.features
            }));

        // Get feature definitions for display
        const featureDefinitions = await featureFlagManager.getAllFeatureDefinitions();
        const featureMap = {};
        featureDefinitions.forEach(f => {
            featureMap[f.code] = {
                name: f.name,
                description: f.description || null,
                category: f.category,
                type: f.type,
                unit: f.unit,
                isPublic: f.isPublic !== false,
                displayOrder: f.displayOrder || 0
            };
        });

        // Usage report
        const usageReport = await usageLimitsService.getUsageReport(tenantId);

        res.status(200).json({
            success: true,
            data: {
                // Current plan info
                currentPlan: currentPlan ? {
                    code: currentPlan.code,
                    name: currentPlan.name,
                    description: currentPlan.description,
                    pricing: currentPlan.pricing
                } : { code: subscription.planCode, name: subscription.planCode, pricing: { monthly: 0, yearly: 0, currency: 'USD' } },

                // Billing details
                billing: {
                    ...subscription.billing.toObject(),
                    nextBillingDate: subscription.billing.currentPeriodEnd || null
                },

                // Payment info (no sensitive data)
                payment: {
                    gateway: subscription.payment.gateway,
                    hasPaymentMethod: !!subscription.payment.paymentMethodId,
                    hasSubscription: !!subscription.payment.subscriptionId
                },

                // Features currently assigned
                features: subscription.features,

                // Available upgrades
                upgradePlans,

                // All plans for full grid display
                allPlans: allPlans.map(p => ({
                    _id: p._id,
                    code: p.code,
                    name: p.name,
                    description: p.description,
                    pricing: p.pricing,
                    badge: p.badge,
                    features: p.features,
                    isPublic: p.isPublic
                })),

                // Feature definitions map
                featureDefinitions: featureMap,

                // Usage
                usage: usageReport.limits || {}
            }
        });
    } catch (error) {
        console.error('❌ getMyPlan error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plan details'
        });
    }
};

/**
 * @route POST /api/subscriptions/subscribe
 * @access Private (Company Admin)
 */
exports.subscribeToPlan = async (req, res) => {
    try {
        const { planCode, billingCycle } = req.body;
        const tenantId = req.user.tenant;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        const result = await subscriptionManager.subscribeToPlan(tenantId, planCode, {
            billingCycle: billingCycle || 'monthly'
        });

        res.status(200).json({
            success: true,
            message: `Successfully subscribed to ${planCode}`,
            data: result
        });
    } catch (error) {
        console.error('❌ subscribeToPlan error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to subscribe to plan'
        });
    }
};

/**
 * @desc Create checkout session for paid subscription
 * @route POST /api/subscriptions/checkout
 * @access Private (Company Admin)
 */
exports.createCheckoutSession = async (req, res) => {
    try {
        const { planCode, billingCycle, successUrl, cancelUrl } = req.body;
        const tenantId = req.user.tenant;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        const result = await subscriptionManager.createCheckoutSession(tenantId, planCode, {
            billingCycle: billingCycle || 'monthly',
            successUrl: successUrl || `${process.env.FRONTEND_URL}/subscription/success`,
            cancelUrl: cancelUrl || `${process.env.FRONTEND_URL}/subscription/cancel`
        });

        res.status(200).json({
            success: true,
            data: {
                sessionId: result.sessionId,
                url: result.url
            }
        });
    } catch (error) {
        console.error('❌ createCheckoutSession error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create checkout session'
        });
    }
};

/**
 * @desc Upgrade to a higher plan (with tier validation, duplicate guard, free→paid checkout routing)
 * @route POST /api/subscriptions/upgrade
 * @access Private (Company Admin)
 */
exports.upgradePlan = async (req, res) => {
    try {
        const { planCode, billingCycle } = req.body;
        const tenantId = req.user.tenant;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        // 1. Fetch current subscription
        const subscription = await TenantSubscription.findOne({ tenant: tenantId });
        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'No subscription found for this tenant'
            });
        }

        // 2. Duplicate-upgrade guard — reject if billing status isn't stable
        if (!['active', 'trialing'].includes(subscription.billing.status) && subscription.planCode !== 'free') {
            return res.status(409).json({
                success: false,
                message: `Cannot upgrade while subscription is in "${subscription.billing.status}" state. Please wait for the current operation to complete.`
            });
        }

        // 3. Plan-tier validation — ensure target plan is higher
        const allPlans = await PlanTemplate.find({ isActive: true }).sort({ displayOrder: 1 });
        const currentIndex = allPlans.findIndex(p => p.code === subscription.planCode);
        const targetIndex = allPlans.findIndex(p => p.code === planCode);

        if (targetIndex < 0) {
            return res.status(404).json({
                success: false,
                message: `Plan "${planCode}" not found`
            });
        }

        if (targetIndex <= currentIndex) {
            return res.status(400).json({
                success: false,
                message: `Cannot upgrade to "${planCode}" — it is the same or a lower tier than your current plan. Use the downgrade endpoint instead.`
            });
        }

        // 4. Check if this is a free→paid upgrade (no Stripe subscription yet)
        const targetPlan = allPlans[targetIndex];
        const isPaidPlan = (targetPlan.pricing?.monthly > 0 || targetPlan.pricing?.yearly > 0);
        const hasStripeSubscription = !!subscription.payment.subscriptionId;

        if (isPaidPlan && !hasStripeSubscription) {
            // Route to Stripe Checkout — user needs to provide payment method
            console.log(`[upgrade] Free→Paid upgrade: routing to checkout for plan "${planCode}"`);
            const cycle = billingCycle || subscription.billing.cycle || 'monthly';
            const result = await subscriptionManager.createCheckoutSession(tenantId, planCode, {
                billingCycle: cycle,
                successUrl: `${process.env.FRONTEND_URL}/app/subscription/my-plan?upgraded=true`,
                cancelUrl: `${process.env.FRONTEND_URL}/app/subscription/my-plan?cancelled=true`
            });

            return res.status(200).json({
                success: true,
                action: 'checkout',
                message: 'Payment required — redirecting to checkout',
                data: {
                    sessionId: result.sessionId,
                    url: result.url
                }
            });
        }

        // 5. In-place upgrade (already has Stripe subscription) — uses proration
        console.log(`[upgrade] In-place Stripe upgrade: ${subscription.planCode} → ${planCode}`);
        const result = await subscriptionManager.upgradePlan(tenantId, planCode);

        res.status(200).json({
            success: true,
            action: 'upgraded',
            message: `Successfully upgraded to ${planCode}`,
            data: result
        });
    } catch (error) {
        console.error('❌ upgradePlan error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upgrade plan'
        });
    }
};

/**
 * @desc Preview upgrade proration — shows credit/charge breakdown before confirming
 * @route POST /api/subscriptions/upgrade-preview
 * @access Private (Company Admin)
 */
exports.previewUpgrade = async (req, res) => {
    try {
        const { planCode } = req.body;
        const tenantId = req.user.tenant;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        // Fetch subscription
        const subscription = await TenantSubscription.findOne({ tenant: tenantId });
        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found'
            });
        }

        // Get target plan
        const targetPlan = await PlanTemplate.getByCode(planCode);
        if (!targetPlan) {
            return res.status(404).json({
                success: false,
                message: `Plan "${planCode}" not found`
            });
        }

        // Get current plan name
        const currentPlan = await PlanTemplate.findById(subscription.planTemplate);

        // If no Stripe subscription, return simple price comparison (free→paid)
        if (!subscription.payment.subscriptionId || !subscription.payment.customerId) {
            const cycle = subscription.billing.cycle || 'monthly';
            const newPrice = cycle === 'yearly' ? targetPlan.pricing.yearly : targetPlan.pricing.monthly;

            return res.status(200).json({
                success: true,
                data: {
                    currentPlan: currentPlan?.name || subscription.planCode,
                    newPlan: targetPlan.name,
                    billingCycle: cycle,
                    credit: 0,
                    charge: newPrice,
                    total: newPrice,
                    currency: targetPlan.pricing.currency || 'USD',
                    isNewSubscription: true,
                    message: `You will be charged $${newPrice}/${cycle === 'yearly' ? 'year' : 'month'} for the ${targetPlan.name} plan.`
                }
            });
        }

        // Use Stripe's retrieveUpcoming to get exact proration
        const cycle = subscription.billing.cycle || 'monthly';
        const newPriceId = cycle === 'yearly'
            ? targetPlan.stripe?.yearlyPriceId
            : targetPlan.stripe?.monthlyPriceId;

        if (!newPriceId) {
            return res.status(400).json({
                success: false,
                message: 'Target plan does not have pricing configured for this billing cycle'
            });
        }

        // Retrieve the current Stripe subscription to get the item ID
        const stripeSub = await stripe.subscriptions.retrieve(subscription.payment.subscriptionId);
        const currentItemId = stripeSub.items.data[0]?.id;

        // Get upcoming invoice preview with the plan change (Stripe v20+ uses createPreview)
        const upcomingInvoice = await stripe.invoices.createPreview({
            customer: subscription.payment.customerId,
            subscription: subscription.payment.subscriptionId,
            subscription_details: {
                items: [{
                    id: currentItemId,
                    price: newPriceId
                }],
                proration_behavior: 'create_prorations'
            }
        });

        // Calculate credit and charge from invoice line items
        let credit = 0;
        let charge = 0;
        for (const line of upcomingInvoice.lines.data) {
            if (line.amount < 0) {
                credit += Math.abs(line.amount);
            } else {
                charge += line.amount;
            }
        }

        // Stripe amounts are in cents
        const currency = upcomingInvoice.currency?.toUpperCase() || 'USD';

        res.status(200).json({
            success: true,
            data: {
                currentPlan: currentPlan?.name || subscription.planCode,
                newPlan: targetPlan.name,
                billingCycle: cycle,
                credit: credit / 100,
                charge: charge / 100,
                total: upcomingInvoice.amount_due / 100,
                currency,
                isNewSubscription: false,
                periodEnd: new Date(stripeSub.current_period_end * 1000),
                message: `You'll receive $${(credit / 100).toFixed(2)} credit for unused time on ${currentPlan?.name || subscription.planCode}. The prorated charge for ${targetPlan.name} is $${(upcomingInvoice.amount_due / 100).toFixed(2)}.`
            }
        });
    } catch (error) {
        console.error('❌ previewUpgrade error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to preview upgrade'
        });
    }
};

/**
 * @desc Downgrade to a lower plan (effective at period end)
 * @route POST /api/subscriptions/downgrade
 * @access Private (Company Admin)
 */
exports.downgradePlan = async (req, res) => {
    try {
        const { planCode } = req.body;
        const tenantId = req.user.tenant;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        const result = await subscriptionManager.downgradePlan(tenantId, planCode);

        res.status(200).json({
            success: true,
            message: result.message,
            data: result
        });
    } catch (error) {
        console.error('❌ downgradePlan error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to downgrade plan'
        });
    }
};

/**
 * @desc Cancel subscription
 * @route POST /api/subscriptions/cancel
 * @access Private (Company Admin)
 */
exports.cancelSubscription = async (req, res) => {
    try {
        const { immediate } = req.body;
        const tenantId = req.user.tenant;

        const result = await subscriptionManager.cancelSubscription(tenantId, immediate === true);

        res.status(200).json({
            success: true,
            message: result.message,
            data: result
        });
    } catch (error) {
        console.error('❌ cancelSubscription error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to cancel subscription'
        });
    }
};

/**
 * @desc Get billing portal URL
 * @route GET /api/subscriptions/billing-portal
 * @access Private (Company Admin)
 */
exports.getBillingPortal = async (req, res) => {
    try {
        const tenantId = req.user.tenant;
        const returnUrl = req.query.returnUrl || `${process.env.FRONTEND_URL}/settings/billing`;

        const result = await subscriptionManager.createBillingPortalSession(tenantId, returnUrl);

        res.status(200).json({
            success: true,
            data: {
                url: result.url
            }
        });
    } catch (error) {
        console.error('❌ getBillingPortal error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create billing portal session'
        });
    }
};

/**
 * @desc Get usage report
 * @route GET /api/subscriptions/usage
 * @access Private
 */
exports.getUsageReport = async (req, res) => {
    try {
        const tenantId = req.user.tenant;
        const report = await usageLimitsService.getUsageReport(tenantId);

        res.status(200).json({
            success: true,
            data: report
        });
    } catch (error) {
        console.error('❌ getUsageReport error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch usage report'
        });
    }
};

/**
 * @desc Compare plans
 * @route GET /api/subscriptions/compare
 * @access Public
 */
exports.comparePlans = async (req, res) => {
    try {
        const { from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({
                success: false,
                message: 'Both "from" and "to" plan codes are required'
            });
        }

        const comparison = await featureFlagManager.comparePlanFeatures(from, to);

        res.status(200).json({
            success: true,
            data: comparison
        });
    } catch (error) {
        console.error('❌ comparePlans error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to compare plans'
        });
    }
};

/**
 * @desc Verify a checkout session and trigger provisioning if webhook hasn't fired
 * @route POST /api/subscriptions/verify-session
 * @access Private (any authenticated user)
 */
exports.verifyCheckoutSession = async (req, res) => {
    try {
        const { sessionId } = req.body;
        const userId = req.user._id.toString();

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'sessionId is required'
            });
        }

        console.log(`[verify-session] User ${userId} verifying session: ${sessionId}`);

        // 1. Retrieve session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // 2. Security: verify session belongs to this user
        const sessionUserId = session.metadata?.userId || session.client_reference_id;
        if (sessionUserId !== userId) {
            console.warn(`[verify-session] ❌ userId mismatch: session=${sessionUserId}, req=${userId}`);
            return res.status(403).json({
                success: false,
                message: 'Session does not belong to this user'
            });
        }

        // 3. Check if already provisioned (user already has tenant with active sub)
        if (req.user.tenant) {
            const existingSub = await TenantSubscription.findOne({ tenant: req.user.tenant });
            if (existingSub && existingSub.billing.status === 'active') {
                console.log(`[verify-session] ✅ Already provisioned for user ${userId}`);
                return res.status(200).json({
                    success: true,
                    provisioned: true,
                    message: 'Subscription already active'
                });
            }
        }

        // 4. Check payment status
        if (session.payment_status !== 'paid') {
            console.log(`[verify-session] ⏳ Payment not yet completed: ${session.payment_status}`);
            return res.status(200).json({
                success: true,
                provisioned: false,
                paymentStatus: session.payment_status,
                message: 'Payment not yet confirmed'
            });
        }

        // 5. Payment is confirmed but webhook hasn't provisioned yet — trigger provisioning
        console.log(`[verify-session] 🔄 Payment confirmed, triggering provisioning for user ${userId}`);

        const eventData = {
            id: session.id,
            customer: session.customer,
            subscription: session.subscription,
            metadata: session.metadata
        };

        await subscriptionManager._handleCheckoutCompleted(eventData, null);

        console.log(`[verify-session] ✅ Provisioning complete for user ${userId}`);

        return res.status(200).json({
            success: true,
            provisioned: true,
            message: 'Subscription provisioned successfully'
        });

    } catch (error) {
        console.error('[verify-session] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to verify session'
        });
    }
};
