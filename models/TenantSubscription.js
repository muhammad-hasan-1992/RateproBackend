// models/TenantSubscription.js
// Per-tenant subscription and feature assignment
// This replaces the old FeatureFlag model with a more flexible structure

const mongoose = require('mongoose');

// Individual feature assignment for a tenant
const tenantFeatureSchema = new mongoose.Schema({
    featureCode: {
        type: String,
        required: true,
        lowercase: true
    },
    enabled: {
        type: Boolean,
        default: false
    },
    limitValue: {
        type: Number,
        default: null
    },
    // For enterprise custom overrides
    customValue: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    // For time-limited feature access (promotions, trials)
    expiresAt: {
        type: Date,
        default: null
    }
}, { _id: false });

const tenantSubscriptionSchema = new mongoose.Schema({
    // One subscription record per tenant
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        unique: true
    },

    // Current plan reference
    planTemplate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PlanTemplate',
        default: null
    },

    // Plan code for quick lookup (denormalized)
    planCode: {
        type: String,
        default: 'free'
    },

    // Billing information
    billing: {
        cycle: {
            type: String,
            enum: ['monthly', 'yearly', 'lifetime'],
            default: 'monthly'
        },
        status: {
            type: String,
            enum: ['active', 'cancelled', 'past_due', 'trialing', 'unpaid'],
            default: 'trialing'
        },
        currentPeriodStart: { type: Date },
        currentPeriodEnd: { type: Date },
        cancelAtPeriodEnd: { type: Boolean, default: false }
    },

    // Payment gateway information
    payment: {
        gateway: {
            type: String,
            enum: ['stripe', 'tap', 'manual', null],
            default: null
        },
        customerId: { type: String, default: null },       // Gateway customer ID
        subscriptionId: { type: String, default: null },   // Gateway subscription ID
        paymentMethodId: { type: String, default: null }
    },

    // Trial information
    trial: {
        active: { type: Boolean, default: true },
        startedAt: { type: Date, default: Date.now },
        endsAt: { type: Date }
    },

    // Dynamic feature assignments (copied from plan + custom overrides)
    features: [tenantFeatureSchema],

    // Current usage tracking (resets monthly)
    usage: {
        surveysThisMonth: { type: Number, default: 0 },
        responsesThisMonth: { type: Number, default: 0 },
        emailsSentThisMonth: { type: Number, default: 0 },
        smsSentThisMonth: { type: Number, default: 0 },
        storageUsedMB: { type: Number, default: 0 },
        lastResetAt: { type: Date, default: Date.now }
    },

    // Metadata
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Indexes
tenantSubscriptionSchema.index({ tenant: 1 }, { unique: true });
tenantSubscriptionSchema.index({ planCode: 1 });
tenantSubscriptionSchema.index({ 'billing.status': 1 });
tenantSubscriptionSchema.index({ 'payment.gateway': 1, 'payment.customerId': 1 });
tenantSubscriptionSchema.index({ 'trial.endsAt': 1 });

// Instance method: Check if a feature is enabled
tenantSubscriptionSchema.methods.hasFeature = function (featureCode) {
    const feature = this.features.find(f => f.featureCode === featureCode.toLowerCase());
    if (!feature) return false;

    // Check expiration
    if (feature.expiresAt && new Date() > feature.expiresAt) return false;

    return feature.enabled;
};

// Instance method: Get feature limit value
tenantSubscriptionSchema.methods.getLimit = function (featureCode) {
    const feature = this.features.find(f => f.featureCode === featureCode.toLowerCase());
    if (!feature) return 0;

    // Check expiration
    if (feature.expiresAt && new Date() > feature.expiresAt) return 0;

    return feature.limitValue || 0;
};

// Instance method: Check if usage is within limit
tenantSubscriptionSchema.methods.isWithinLimit = function (featureCode, currentUsage) {
    const limit = this.getLimit(featureCode);
    if (limit === -1) return true; // Unlimited
    return currentUsage < limit;
};

// Instance method: Update usage
tenantSubscriptionSchema.methods.incrementUsage = async function (usageType, amount = 1) {
    const validTypes = ['surveysThisMonth', 'responsesThisMonth', 'emailsSentThisMonth', 'smsSentThisMonth', 'storageUsedMB'];
    if (!validTypes.includes(usageType)) {
        throw new Error(`Invalid usage type: ${usageType}`);
    }

    this.usage[usageType] += amount;
    return this.save();
};

// Instance method: Reset monthly usage
tenantSubscriptionSchema.methods.resetMonthlyUsage = async function () {
    this.usage.surveysThisMonth = 0;
    this.usage.responsesThisMonth = 0;
    this.usage.emailsSentThisMonth = 0;
    this.usage.smsSentThisMonth = 0;
    this.usage.lastResetAt = new Date();
    return this.save();
};

// Instance method: Update features from plan template
tenantSubscriptionSchema.methods.applyPlanFeatures = async function (planTemplate) {
    // Keep custom features that aren't in the plan
    const customFeatures = this.features.filter(f => f.customValue !== null);

    // Copy features from plan
    this.features = planTemplate.features.map(pf => ({
        featureCode: pf.featureCode,
        enabled: pf.enabled,
        limitValue: pf.limitValue,
        customValue: null,
        expiresAt: null
    }));

    // Re-apply custom overrides
    for (const cf of customFeatures) {
        const existing = this.features.find(f => f.featureCode === cf.featureCode);
        if (existing) {
            existing.customValue = cf.customValue;
            if (cf.customValue !== null) {
                existing.limitValue = cf.customValue;
                existing.enabled = true;
            }
        }
    }

    this.planTemplate = planTemplate._id;
    this.planCode = planTemplate.code;

    return this.save();
};

// Static method: Find or create subscription for tenant
tenantSubscriptionSchema.statics.findOrCreateForTenant = async function (tenantId, createdBy = null) {
    let subscription = await this.findOne({ tenant: tenantId });

    if (!subscription) {
        // Create with free plan defaults
        subscription = await this.create({
            tenant: tenantId,
            planCode: 'free',
            createdBy,
            trial: {
                active: true,
                startedAt: new Date(),
                endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days trial
            }
        });
    }

    return subscription;
};

// Static method: Get by gateway customer ID
tenantSubscriptionSchema.statics.findByGatewayCustomer = function (gateway, customerId) {
    return this.findOne({
        'payment.gateway': gateway,
        'payment.customerId': customerId
    });
};

module.exports = mongoose.model('TenantSubscription', tenantSubscriptionSchema);
