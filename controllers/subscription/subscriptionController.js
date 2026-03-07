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
 * @desc Subscribe to a plan (for manual/free plans without payment)
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
 * @desc Upgrade to a higher plan
 * @route POST /api/subscriptions/upgrade
 * @access Private (Company Admin)
 */
exports.upgradePlan = async (req, res) => {
    try {
        const { planCode } = req.body;
        const tenantId = req.user.tenant;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        const result = await subscriptionManager.upgradePlan(tenantId, planCode);

        res.status(200).json({
            success: true,
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
