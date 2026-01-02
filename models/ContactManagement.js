// models/Contact.js
const mongoose = require("mongoose");

const ContactSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true,
  },

  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  company: String,

  tags: {
    type: [String],
    default: [],
    index: true,
  },

  autoTags: {
    type: [String],
    default: [],
    index: true,
  },

  contactCategories: {
    type: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ContactCategory",  // 🔥 Changed from "UserCategory"
      },
    ],
    validate: {
      validator: function (v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: "Contact must belong to at least one category",
    },
    index: true,
  },

  enrichment: {
    country: String,
    countryCode: String,
    city: String,
    region: String,
    gender: String,
    company: String,
    domain: String,
    inferredAt: Date,
    source: String,
  },

  status: {
    type: String,
    enum: ["Active", "Inactive", "Blocked"],
    default: "Active",
    index: true,
  },

  lastActivity: {
    type: Date,
    index: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },

  // ─────────────────────────────────────────────────────────────
  // 🔥 NEW: Survey & Response Tracking (denormalized for segments)
  // ─────────────────────────────────────────────────────────────

  surveyStats: {
    // Total number of survey invitations sent to this contact
    invitedCount: {
      type: Number,
      default: 0,
      index: true,
    },

    // Total number of surveys this contact has responded to
    respondedCount: {
      type: Number,
      default: 0,
      index: true,
    },

    // Date of most recent survey response
    lastResponseDate: {
      type: Date,
      index: true,
    },

    // Date of most recent invitation
    lastInvitedDate: {
      type: Date,
      index: true,
    },

    // Latest NPS score (0-10)
    latestNpsScore: {
      type: Number,
      min: 0,
      max: 10,
      index: true,
    },

    // Average NPS score across all responses
    avgNpsScore: {
      type: Number,
      min: 0,
      max: 10,
    },

    // Latest satisfaction rating (1-5)
    latestRating: {
      type: Number,
      min: 1,
      max: 5,
    },

    // Average rating across all responses
    avgRating: {
      type: Number,
      min: 1,
      max: 5,
    },

    // NPS category: promoter (9-10), passive (7-8), detractor (0-6)
    npsCategory: {
      type: String,
      enum: ["promoter", "passive", "detractor"],
      index: true,
    },
  },
});

// 🔥 Multi-tenant email uniqueness
ContactSchema.index({ tenantId: 1, email: 1 }, { unique: true });

// 🔥 Compound indexes for segment queries
ContactSchema.index({ tenantId: 1, "surveyStats.lastResponseDate": -1 });
ContactSchema.index({ tenantId: 1, "surveyStats.latestNpsScore": 1 });
ContactSchema.index({ tenantId: 1, "surveyStats.npsCategory": 1 });
ContactSchema.index({ tenantId: 1, "surveyStats.invitedCount": 1, "surveyStats.respondedCount": 1 });
ContactSchema.index({ tenantId: 1, "enrichment.country": 1 });
ContactSchema.index({ tenantId: 1, "enrichment.city": 1 });
ContactSchema.index({ tenantId: 1, "enrichment.region": 1 });

module.exports = mongoose.model("Contact", ContactSchema);