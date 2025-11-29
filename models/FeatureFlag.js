// models/FeatureFlag.js   ← Ye naye naam se banega, Subscription.js delete/replace
const mongoose = require('mongoose');

const featureFlagSchema = new mongoose.Schema({
  tenant: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Tenant', 
    required: true,
    unique: true 
  }, // One flag set per tenant

  // Core Billing (jo pehle Subscription mein tha)
  plan: { 
    type: String, 
    enum: ['free', 'starter', 'pro', 'enterprise'], 
    default: 'free' 
  },
  billingCycle: { type: String, enum: ['monthly', 'yearly'] },
  status: { type: String, enum: ['active', 'cancelled', 'trial'], default: 'trial' },
  trialEndsAt: Date,
  currentPeriodEnd: Date,

  // 🔥 Feature Flags (boolean toggles)
  flags: {
    aiSurveyGeneration: { type: Boolean, default: false },
    whatsappDistribution: { type: Boolean, default: false },
    smsDistribution: { type: Boolean, default: true },
    advancedAnalytics: { type: Boolean, default: false },
    customBranding: { type: Boolean, default: false },
    apiAccess: { type: Boolean, default: false },
    smartSegments: { type: Boolean, default: false },        // ← Week 1
    actionEngine: { type: Boolean, default: false },
    incentives: { type: Boolean, default: false },
    deliveryIntelligence: { type: Boolean, default: false },
    whiteLabel: { type: Boolean, default: false },
    slaManagement: { type: Boolean, default: false },
    multiLanguage: { type: Boolean, default: true },
    prioritySupport: { type: Boolean, default: false },
  },

  limits: {
    monthlySurveys: { type: Number, default: 10 },
    monthlyResponses: { type: Number, default: 500 },
    teamMembers: { type: Number, default: 3 },
    segments: { type: Number, default: 5 },
    actionsPerMonth: { type: Number, default: 50 },
    storageGB: { type: Number, default: 1 },
  },

  usage: { // Real-time usage tracking
    surveysThisMonth: { type: Number, default: 0 },
    responsesThisMonth: { type: Number, default: 0 },
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Index
featureFlagSchema.index({ tenant: 1 }, { unique: true });

module.exports = mongoose.model('FeatureFlag', featureFlagSchema);