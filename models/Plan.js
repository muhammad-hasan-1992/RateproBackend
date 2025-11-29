// models/Plan.js
const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: String,
    features: {
        type: Object,
        default: {}
    },
    limits: {
        responsesPerMonth: { type: Number, default: 1000 },
        teamMembers: { type: Number, default: 5 },
        surveys: { type: String, default: 'unlimited' }
    },
    features: {
        type: Object,
        default: {
            smartSegments: false,
            actionEngine: false,
            deliveryIntelligence: false,
            globalAiBrain: false,
            advancedDistribution: false,
            customBranding: false,
            whiteLabel: false
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Plan', PlanSchema);