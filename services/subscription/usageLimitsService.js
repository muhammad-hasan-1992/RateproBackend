// services/subscription/usageLimitsService.js
// Tracks and enforces usage limits for tenants

const TenantSubscription = require('../../models/TenantSubscription');

// Mapping of limit codes to usage fields
const LIMIT_USAGE_MAP = {
    'max_active_surveys': 'surveysThisMonth',
    'max_responses_monthly': 'responsesThisMonth',
    'email_monthly_limit': 'emailsSentThisMonth',
    'sms_monthly_limit': 'smsSentThisMonth',
    'storage_gb': 'storageUsedMB'
};

// Mapping of limit codes to check functions (for non-usage-based limits)
const SPECIAL_LIMIT_CHECKS = {
    'max_users': async (tenantId, limit) => {
        const User = require('../../models/User');
        const count = await User.countDocuments({ tenant: tenantId, isActive: true });
        return { current: count, limit, allowed: count < limit };
    },
    'max_segments': async (tenantId, limit) => {
        const AudienceSegment = require('../../models/AudienceSegment');
        const count = await AudienceSegment.countDocuments({ tenant: tenantId });
        return { current: count, limit, allowed: count < limit };
    }
};

class UsageLimitsService {
    /**
     * Check if a tenant is within a specific limit
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} limitCode - Limit code to check
     * @returns {Promise<Object>} - { allowed, current, limit, message }
     */
    async checkLimit(tenantId, limitCode) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });

            if (!subscription) {
                return {
                    allowed: false,
                    current: 0,
                    limit: 0,
                    message: 'No subscription found for tenant'
                };
            }

            const limit = subscription.getLimit(limitCode);

            // Unlimited access
            if (limit === -1) {
                return {
                    allowed: true,
                    current: 0,
                    limit: -1,
                    message: 'Unlimited access'
                };
            }

            // Check for special limits (count-based)
            if (SPECIAL_LIMIT_CHECKS[limitCode]) {
                return await SPECIAL_LIMIT_CHECKS[limitCode](tenantId, limit);
            }

            // Check usage-based limits
            const usageField = LIMIT_USAGE_MAP[limitCode];
            if (usageField) {
                const current = subscription.usage[usageField] || 0;
                const allowed = current < limit;

                return {
                    allowed,
                    current,
                    limit,
                    remaining: Math.max(0, limit - current),
                    message: allowed
                        ? `${limit - current} remaining of ${limit}`
                        : `Limit of ${limit} reached`
                };
            }

            // Unknown limit code
            return {
                allowed: true,
                current: 0,
                limit: 0,
                message: 'Limit code not tracked'
            };
        } catch (error) {
            console.error('❌ UsageLimitsService.checkLimit error:', error.message);
            throw error;
        }
    }

    /**
     * Increment usage for a tenant
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} limitCode - Limit code to increment
     * @param {number} amount - Amount to increment (default 1)
     * @returns {Promise<Object>} - { success, newValue }
     */
    async incrementUsage(tenantId, limitCode, amount = 1) {
        try {
            const usageField = LIMIT_USAGE_MAP[limitCode];
            if (!usageField) {
                return { success: false, message: 'Invalid limit code for usage tracking' };
            }

            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                return { success: false, message: 'Subscription not found' };
            }

            await subscription.incrementUsage(usageField, amount);

            return {
                success: true,
                newValue: subscription.usage[usageField]
            };
        } catch (error) {
            console.error('❌ UsageLimitsService.incrementUsage error:', error.message);
            throw error;
        }
    }

    /**
     * Decrement usage for a tenant
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} limitCode - Limit code to decrement
     * @param {number} amount - Amount to decrement (default 1)
     * @returns {Promise<Object>}
     */
    async decrementUsage(tenantId, limitCode, amount = 1) {
        try {
            const usageField = LIMIT_USAGE_MAP[limitCode];
            if (!usageField) {
                return { success: false, message: 'Invalid limit code for usage tracking' };
            }

            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                return { success: false, message: 'Subscription not found' };
            }

            // Prevent negative values
            const newValue = Math.max(0, subscription.usage[usageField] - amount);
            subscription.usage[usageField] = newValue;
            await subscription.save();

            return {
                success: true,
                newValue
            };
        } catch (error) {
            console.error('❌ UsageLimitsService.decrementUsage error:', error.message);
            throw error;
        }
    }

    /**
     * Get all usage and limits for a tenant
     * @param {string} tenantId - Tenant ObjectId
     * @returns {Promise<Object>} - Full usage report
     */
    async getUsageReport(tenantId) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId })
                .populate('planTemplate', 'name code');

            if (!subscription) {
                return { error: 'Subscription not found' };
            }

            const limits = {};

            // Get all limit-type features
            for (const feature of subscription.features) {
                if (feature.limitValue !== null) {
                    const usageField = LIMIT_USAGE_MAP[feature.featureCode];
                    let current = 0;

                    if (usageField) {
                        current = subscription.usage[usageField] || 0;
                    } else if (SPECIAL_LIMIT_CHECKS[feature.featureCode]) {
                        const checkResult = await SPECIAL_LIMIT_CHECKS[feature.featureCode](
                            tenantId,
                            feature.limitValue
                        );
                        current = checkResult.current;
                    }

                    const limit = feature.limitValue;
                    limits[feature.featureCode] = {
                        current,
                        limit: limit === -1 ? 'unlimited' : limit,
                        percentage: limit === -1 ? 0 : Math.round((current / limit) * 100),
                        remaining: limit === -1 ? 'unlimited' : Math.max(0, limit - current)
                    };
                }
            }

            return {
                tenant: tenantId,
                plan: {
                    code: subscription.planCode,
                    name: subscription.planTemplate?.name
                },
                billing: subscription.billing,
                limits,
                usage: subscription.usage,
                lastResetAt: subscription.usage.lastResetAt
            };
        } catch (error) {
            console.error('❌ UsageLimitsService.getUsageReport error:', error.message);
            throw error;
        }
    }

    /**
     * Reset monthly usage for all tenants (called by cron)
     * @returns {Promise<Object>} - { count, errors }
     */
    async resetAllMonthlyUsage() {
        try {
            const result = await TenantSubscription.updateMany(
                {},
                {
                    $set: {
                        'usage.surveysThisMonth': 0,
                        'usage.responsesThisMonth': 0,
                        'usage.emailsSentThisMonth': 0,
                        'usage.smsSentThisMonth': 0,
                        'usage.lastResetAt': new Date()
                    }
                }
            );

            console.log(`✅ Reset monthly usage for ${result.modifiedCount} subscriptions`);
            return { count: result.modifiedCount, errors: 0 };
        } catch (error) {
            console.error('❌ UsageLimitsService.resetAllMonthlyUsage error:', error.message);
            throw error;
        }
    }

    /**
     * Check if tenant can perform an action (combines limit check)
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} limitCode - Limit code
     * @param {number} requiredAmount - Amount needed (default 1)
     * @returns {Promise<Object>}
     */
    async canPerformAction(tenantId, limitCode, requiredAmount = 1) {
        const result = await this.checkLimit(tenantId, limitCode);

        if (!result.allowed) {
            return {
                allowed: false,
                reason: 'limit_exceeded',
                message: result.message,
                current: result.current,
                limit: result.limit
            };
        }

        // For usage-based limits, check if enough headroom
        if (result.limit !== -1 && result.remaining < requiredAmount) {
            return {
                allowed: false,
                reason: 'insufficient_quota',
                message: `Need ${requiredAmount} but only ${result.remaining} remaining`,
                current: result.current,
                limit: result.limit,
                remaining: result.remaining
            };
        }

        return {
            allowed: true,
            remaining: result.remaining,
            limit: result.limit
        };
    }
}

module.exports = new UsageLimitsService();
