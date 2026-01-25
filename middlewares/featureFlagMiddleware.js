// middlewares/featureFlagMiddleware.js
// Enhanced middleware for checking feature access and limits

const TenantSubscription = require('../models/TenantSubscription');
const usageLimitsService = require('../services/subscription/usageLimitsService');

/**
 * Middleware to require a specific feature flag
 * @param {string} featureCode - Feature code to check
 * @returns {Function} Express middleware
 */
exports.requireFlag = (featureCode) => async (req, res, next) => {
  try {
    // Super admin bypasses all checks
    if (req.user.role === 'admin') return next();

    const tenantId = req.user.tenant;
    if (!tenantId) {
      return res.status(403).json({
        success: false,
        message: 'No tenant associated with this user'
      });
    }

    const subscription = await TenantSubscription.findOne({ tenant: tenantId });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No subscription found. Please subscribe to a plan.',
        upgradeRequired: true,
        code: 'NO_SUBSCRIPTION'
      });
    }

    // Check if feature is enabled
    if (!subscription.hasFeature(featureCode)) {
      return res.status(403).json({
        success: false,
        message: `Feature "${featureCode}" is not available on your current plan`,
        featureCode,
        currentPlan: subscription.planCode,
        upgradeRequired: true,
        code: 'FEATURE_NOT_AVAILABLE'
      });
    }

    // Attach subscription to request for downstream use
    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('❌ requireFlag middleware error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error checking feature access'
    });
  }
};

/**
 * Middleware to check multiple features (all must be enabled)
 * @param {Array<string>} featureCodes - Array of feature codes
 * @returns {Function} Express middleware
 */
exports.requireAllFlags = (featureCodes) => async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return next();

    const tenantId = req.user.tenant;
    const subscription = await TenantSubscription.findOne({ tenant: tenantId });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No subscription found',
        upgradeRequired: true
      });
    }

    const missingFeatures = [];
    for (const code of featureCodes) {
      if (!subscription.hasFeature(code)) {
        missingFeatures.push(code);
      }
    }

    if (missingFeatures.length > 0) {
      return res.status(403).json({
        success: false,
        message: `Missing required features: ${missingFeatures.join(', ')}`,
        missingFeatures,
        currentPlan: subscription.planCode,
        upgradeRequired: true,
        code: 'FEATURES_NOT_AVAILABLE'
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('❌ requireAllFlags middleware error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error checking feature access'
    });
  }
};

/**
 * Middleware to check if any of the features is enabled
 * @param {Array<string>} featureCodes - Array of feature codes
 * @returns {Function} Express middleware
 */
exports.requireAnyFlag = (featureCodes) => async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return next();

    const tenantId = req.user.tenant;
    const subscription = await TenantSubscription.findOne({ tenant: tenantId });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No subscription found',
        upgradeRequired: true
      });
    }

    const hasAnyFeature = featureCodes.some(code => subscription.hasFeature(code));

    if (!hasAnyFeature) {
      return res.status(403).json({
        success: false,
        message: `Requires one of: ${featureCodes.join(', ')}`,
        requiredFeatures: featureCodes,
        currentPlan: subscription.planCode,
        upgradeRequired: true,
        code: 'NO_MATCHING_FEATURES'
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('❌ requireAnyFlag middleware error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error checking feature access'
    });
  }
};

/**
 * Middleware to check usage limit before allowing action
 * @param {string} limitCode - Limit code to check
 * @param {number} requiredAmount - Amount needed (default 1)
 * @returns {Function} Express middleware
 */
exports.checkLimit = (limitCode, requiredAmount = 1) => async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return next();

    const tenantId = req.user.tenant;
    const result = await usageLimitsService.canPerformAction(tenantId, limitCode, requiredAmount);

    if (!result.allowed) {
      return res.status(403).json({
        success: false,
        message: result.message,
        reason: result.reason,
        current: result.current,
        limit: result.limit,
        remaining: result.remaining,
        limitCode,
        upgradeRequired: true,
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Attach limit info to request
    req.limitInfo = {
      limitCode,
      remaining: result.remaining,
      limit: result.limit
    };

    next();
  } catch (error) {
    console.error('❌ checkLimit middleware error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error checking usage limit'
    });
  }
};

/**
 * Middleware to increment usage after successful operation
 * Should be called after the main operation succeeds
 * @param {string} limitCode - Limit code to increment
 * @param {number} amount - Amount to increment (default 1)
 * @returns {Function} Express middleware
 */
exports.incrementUsage = (limitCode, amount = 1) => async (req, res, next) => {
  try {
    const tenantId = req.user.tenant;
    await usageLimitsService.incrementUsage(tenantId, limitCode, amount);
    next();
  } catch (error) {
    console.error('❌ incrementUsage middleware error:', error.message);
    // Don't fail the request, just log the error
    next();
  }
};

/**
 * Middleware to attach subscription info to request without blocking
 * Useful for routes that need subscription info but don't require specific features
 * @returns {Function} Express middleware
 */
exports.attachSubscription = async (req, res, next) => {
  try {
    if (req.user?.tenant) {
      const subscription = await TenantSubscription.findOne({ tenant: req.user.tenant })
        .populate('planTemplate', 'code name');
      req.subscription = subscription;
    }
    next();
  } catch (error) {
    console.error('❌ attachSubscription middleware error:', error.message);
    next();
  }
};

/**
 * Middleware to require active subscription (not cancelled or past_due)
 * @returns {Function} Express middleware
 */
exports.requireActiveSubscription = async (req, res, next) => {
  try {
    if (req.user.role === 'admin') return next();

    const tenantId = req.user.tenant;
    const subscription = await TenantSubscription.findOne({ tenant: tenantId });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'No subscription found',
        code: 'NO_SUBSCRIPTION'
      });
    }

    const activeStatuses = ['active', 'trialing'];
    if (!activeStatuses.includes(subscription.billing.status)) {
      return res.status(403).json({
        success: false,
        message: `Subscription is ${subscription.billing.status}. Please update your payment method.`,
        status: subscription.billing.status,
        code: 'SUBSCRIPTION_INACTIVE'
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('❌ requireActiveSubscription middleware error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error checking subscription status'
    });
  }
};