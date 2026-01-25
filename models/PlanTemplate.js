// models/PlanTemplate.js
// Plans are bundles of feature flags - no business logic coupled to plan names
// Adding new plans or modifying features = database changes only

const mongoose = require('mongoose');

const planFeatureSchema = new mongoose.Schema({
    featureCode: {
        type: String,
        required: true,
        lowercase: true
    },
    enabled: {
        type: Boolean,
        default: true
    },
    limitValue: {
        type: Number,
        default: null  // Only for 'limit' type features
    }
}, { _id: false });

const planTemplateSchema = new mongoose.Schema({
    // Unique plan code (e.g., 'free', 'starter', 'pro', 'enterprise')
    code: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    // Display name
    name: {
        type: String,
        required: true,
        trim: true
    },

    // Description for pricing page
    description: {
        type: String,
        trim: true
    },

    // Pricing structure
    pricing: {
        monthly: { type: Number, default: 0 },
        yearly: { type: Number, default: 0 },
        currency: { type: String, default: 'USD' }
    },

    // Stripe Product/Price IDs for payment integration
    stripe: {
        productId: { type: String, default: null },
        monthlyPriceId: { type: String, default: null },
        yearlyPriceId: { type: String, default: null }
    },

    // Tap Payment IDs (for MENA region)
    tap: {
        productId: { type: String, default: null },
        monthlyPriceId: { type: String, default: null },
        yearlyPriceId: { type: String, default: null }
    },

    // Features included in this plan
    features: [planFeatureSchema],

    // Trial configuration
    trial: {
        enabled: { type: Boolean, default: false },
        days: { type: Number, default: 14 }
    },

    // Whether this plan is shown on public pricing page
    isPublic: {
        type: Boolean,
        default: true
    },

    // Whether this plan can be subscribed to
    isActive: {
        type: Boolean,
        default: true
    },

    // Display order on pricing page
    displayOrder: {
        type: Number,
        default: 0
    },

    // Highlight badge (e.g., "Most Popular", "Best Value")
    badge: {
        type: String,
        default: null
    },

    // Created by admin
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Indexes
planTemplateSchema.index({ code: 1 }, { unique: true });
planTemplateSchema.index({ isActive: 1, isPublic: 1, displayOrder: 1 });

// Virtual for yearly discount percentage
planTemplateSchema.virtual('yearlyDiscount').get(function () {
    if (!this.pricing.monthly || !this.pricing.yearly) return 0;
    const monthlyYearly = this.pricing.monthly * 12;
    return Math.round((1 - (this.pricing.yearly / monthlyYearly)) * 100);
});

// Static method to get public plans for pricing page
planTemplateSchema.statics.getPublicPlans = function () {
    return this.find({ isActive: true, isPublic: true })
        .sort({ displayOrder: 1 })
        .select('-stripe -tap -createdBy');
};

// Static method to get plan by code
planTemplateSchema.statics.getByCode = function (code) {
    return this.findOne({ code: code.toLowerCase(), isActive: true });
};

// Instance method to get feature value
planTemplateSchema.methods.getFeatureValue = function (featureCode) {
    const feature = this.features.find(f => f.featureCode === featureCode);
    if (!feature) return null;
    return feature.limitValue !== null ? feature.limitValue : feature.enabled;
};

// Ensure virtuals are included in JSON
planTemplateSchema.set('toJSON', { virtuals: true });
planTemplateSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('PlanTemplate', planTemplateSchema);
