// controllers/subscription/subscriptionController.js
// Subscription management API endpoints

const subscriptionManager = require('../../services/subscription/subscriptionManager');
const featureFlagManager = require('../../services/subscription/featureFlagManager');
const usageLimitsService = require('../../services/subscription/usageLimitsService');
const PlanTemplate = require('../../models/PlanTemplate');
const TenantSubscription = require('../../models/TenantSubscription');

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
                category: f.category,
                type: f.type,
                unit: f.unit
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
