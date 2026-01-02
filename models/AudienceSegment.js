// models/AudienceSegment.js
const mongoose = require("mongoose");

const AudienceSegmentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true,
    index: true,
  },

  name: {
    type: String,
    required: true,
  },

  description: String,

  // 🔥 NEW: Store original filters (for UI editing)
  filters: {
    type: Object,
    default: {},
  },

  // Compiled Mongo query (for execution)
  query: {
    type: Object,
    required: true,
  },

  isSystem: {
    type: Boolean,
    default: false,
    index: true,
  },

  // 🔥 NEW: Cached count (refreshed periodically)
  cachedCount: {
    value: Number,
    updatedAt: Date,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update timestamp on save
AudienceSegmentSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Unique name per tenant
AudienceSegmentSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("AudienceSegment", AudienceSegmentSchema);
