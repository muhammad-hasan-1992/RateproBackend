// services/subscription/featureFlagManager.js
// Manages feature flags for tenants - the core of feature-driven architecture

const TenantSubscription = require('../../models/TenantSubscription');
const FeatureDefinition = require('../../models/FeatureDefinition');
const PlanTemplate = require('../../models/PlanTemplate');

class FeatureFlagManager {
    /**
     * Check if a tenant has access to a specific feature
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} featureCode - Feature code to check
     * @returns {Promise<boolean>}
     */
    async hasFeature(tenantId, featureCode) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) return false;

            return subscription.hasFeature(featureCode);
        } catch (error) {
            console.error('❌ FeatureFlagManager.hasFeature error:', error.message);
            return false;
        }
    }

    /**
     * Get the limit value for a feature
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} featureCode - Feature code
     * @returns {Promise<number>} - Limit value, 0 if not found, -1 for unlimited
     */
    async getLimit(tenantId, featureCode) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) return 0;

            return subscription.getLimit(featureCode);
        } catch (error) {
            console.error('❌ FeatureFlagManager.getLimit error:', error.message);
            return 0;
        }
    }

    /**
     * Get all features for a tenant
     * @param {string} tenantId - Tenant ObjectId
     * @returns {Promise<Object>} - { features: [], planCode, billing }
     */
    async getTenantFeatures(tenantId) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId })
                .populate('planTemplate', 'code name');

            if (!subscription) {
                return {
                    features: [],
                    planCode: 'free',
                    billing: { status: 'trialing' }
                };
            }

            // Denormalize features for easier frontend use
            const featureMap = {};
            for (const f of subscription.features) {
                featureMap[f.featureCode] = f.limitValue !== null ? f.limitValue : f.enabled;
            }

            return {
                features: subscription.features,
                featureMap,
                planCode: subscription.planCode,
                planName: subscription.planTemplate?.name,
                billing: subscription.billing,
                usage: subscription.usage
            };
        } catch (error) {
            console.error('❌ FeatureFlagManager.getTenantFeatures error:', error.message);
            throw error;
        }
    }

    /**
     * Apply plan features to a tenant
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} planCode - Plan code to apply
     * @returns {Promise<TenantSubscription>}
     */
    async applyPlan(tenantId, planCode) {
        try {
            const planTemplate = await PlanTemplate.getByCode(planCode);
            if (!planTemplate) {
                throw new Error(`Plan not found: ${planCode}`);
            }

            let subscription = await TenantSubscription.findOne({ tenant: tenantId });

            if (!subscription) {
                subscription = await TenantSubscription.create({
                    tenant: tenantId,
                    planTemplate: planTemplate._id,
                    planCode: planTemplate.code,
                    features: planTemplate.features.map(f => ({
                        featureCode: f.featureCode,
                        enabled: f.enabled,
                        limitValue: f.limitValue
                    }))
                });
            } else {
                await subscription.applyPlanFeatures(planTemplate);
            }

            return subscription;
        } catch (error) {
            console.error('❌ FeatureFlagManager.applyPlan error:', error.message);
            throw error;
        }
    }

    /**
     * Set a custom feature override for a tenant (enterprise customers)
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} featureCode - Feature code
     * @param {any} value - Custom value (boolean or number)
     * @param {Date} expiresAt - Optional expiration date
     * @returns {Promise<TenantSubscription>}
     */
    async setCustomFeature(tenantId, featureCode, value, expiresAt = null) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                throw new Error('Tenant subscription not found');
            }

            const existingFeature = subscription.features.find(f => f.featureCode === featureCode);

            if (existingFeature) {
                existingFeature.customValue = value;
                existingFeature.enabled = typeof value === 'boolean' ? value : true;
                existingFeature.limitValue = typeof value === 'number' ? value : existingFeature.limitValue;
                existingFeature.expiresAt = expiresAt;
            } else {
                subscription.features.push({
                    featureCode,
                    enabled: typeof value === 'boolean' ? value : true,
                    limitValue: typeof value === 'number' ? value : null,
                    customValue: value,
                    expiresAt
                });
            }

            return subscription.save();
        } catch (error) {
            console.error('❌ FeatureFlagManager.setCustomFeature error:', error.message);
            throw error;
        }
    }

    /**
     * Remove a custom feature override
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} featureCode - Feature code
     * @returns {Promise<TenantSubscription>}
     */
    async removeCustomFeature(tenantId, featureCode) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                throw new Error('Tenant subscription not found');
            }

            const feature = subscription.features.find(f => f.featureCode === featureCode);
            if (feature) {
                feature.customValue = null;
                // Revert to plan default
                const plan = await PlanTemplate.findById(subscription.planTemplate);
                if (plan) {
                    const planFeature = plan.features.find(f => f.featureCode === featureCode);
                    if (planFeature) {
                        feature.enabled = planFeature.enabled;
                        feature.limitValue = planFeature.limitValue;
                    }
                }
            }

            return subscription.save();
        } catch (error) {
            console.error('❌ FeatureFlagManager.removeCustomFeature error:', error.message);
            throw error;
        }
    }

    /**
     * Get all available features from the master catalog
     * @returns {Promise<Array>}
     */
    async getAllFeatureDefinitions() {
        return FeatureDefinition.getActiveFeatures();
    }

    /**
     * Create a new feature definition (admin only)
     * @param {Object} featureData - Feature definition data
     * @returns {Promise<FeatureDefinition>}
     */
    async createFeatureDefinition(featureData) {
        return FeatureDefinition.create(featureData);
    }

    /**
     * Compare features between two plans
     * @param {string} planCodeA - First plan code
     * @param {string} planCodeB - Second plan code
     * @returns {Promise<Object>} - { added: [], removed: [], changed: [] }
     */
    async comparePlanFeatures(planCodeA, planCodeB) {
        const planA = await PlanTemplate.getByCode(planCodeA);
        const planB = await PlanTemplate.getByCode(planCodeB);

        if (!planA || !planB) {
            throw new Error('One or both plans not found');
        }

        const featuresA = new Map(planA.features.map(f => [f.featureCode, f]));
        const featuresB = new Map(planB.features.map(f => [f.featureCode, f]));

        const added = [];
        const removed = [];
        const changed = [];

        // Features in B but not in A (added on upgrade)
        for (const [code, feature] of featuresB) {
            if (!featuresA.has(code)) {
                added.push(feature);
            } else {
                const featureA = featuresA.get(code);
                if (featureA.enabled !== feature.enabled || featureA.limitValue !== feature.limitValue) {
                    changed.push({ from: featureA, to: feature });
                }
            }
        }

        // Features in A but not in B (removed on downgrade)
        for (const [code, feature] of featuresA) {
            if (!featuresB.has(code)) {
                removed.push(feature);
            }
        }

        return { added, removed, changed };
    }
}

module.exports = new FeatureFlagManager();
