// models/FeatureDefinition.js
// Master catalog of all available features
// Adding new features = just add a document, no code changes needed

const mongoose = require('mongoose');

const featureDefinitionSchema = new mongoose.Schema({
    // Unique feature code (e.g., "advanced_logic", "action_mgmt", "incentives")
    code: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    // Human-readable name
    name: {
        type: String,
        required: true,
        trim: true
    },

    // Description for admin UI
    description: {
        type: String,
        trim: true
    },

    // Category for grouping in UI
    category: {
        type: String,
        enum: [
            'core',           // Basic survey features
            'analytics',      // Advanced analytics, AI insights
            'distribution',   // SMS, WhatsApp, Email channels
            'branding',       // White-label, custom branding
            'automation',     // Action engine, escalations
            'integration',    // API access, webhooks
            'support'         // Priority support, SLA
        ],
        default: 'core'
    },

    // Type determines how the feature is stored/checked
    type: {
        type: String,
        enum: ['boolean', 'limit'],  // boolean = on/off, limit = numeric value
        default: 'boolean'
    },

    // Default value when not specified in plan
    defaultValue: {
        type: mongoose.Schema.Types.Mixed,
        default: function () {
            return this.type === 'boolean' ? false : 0;
        }
    },

    // Unit for limit types (e.g., "surveys", "responses", "GB")
    unit: {
        type: String,
        default: null
    },

    // Whether this feature is visible in public pricing page
    isPublic: {
        type: Boolean,
        default: true
    },

    // Whether this feature can be assigned to tenants
    isActive: {
        type: Boolean,
        default: true
    },

    // Display order in UI
    displayOrder: {
        type: Number,
        default: 0
    },

    // Metadata for UI display
    metadata: {
        icon: String,           // Icon name for UI
        tooltip: String,        // Help text
        upgradePrompt: String   // Message shown when limit reached
    }
}, {
    timestamps: true
});

// Indexes
featureDefinitionSchema.index({ code: 1 }, { unique: true });
featureDefinitionSchema.index({ category: 1, displayOrder: 1 });
featureDefinitionSchema.index({ isActive: 1 });

// Static method to get all active features
featureDefinitionSchema.statics.getActiveFeatures = function () {
    return this.find({ isActive: true }).sort({ category: 1, displayOrder: 1 });
};

// Static method to get feature by code
featureDefinitionSchema.statics.getByCode = function (code) {
    return this.findOne({ code: code.toLowerCase(), isActive: true });
};

module.exports = mongoose.model('FeatureDefinition', featureDefinitionSchema);
