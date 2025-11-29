// models/SmartSegment.js (AudienceSegment.js ko replace kar denge)
const mongoose = require('mongoose');

const smartSegmentSchema = new mongoose.Schema({
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  description: String,

  // 🔥 Dynamic Query Builder (MongoDB style)
  rules: {
    logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
    conditions: [
      {
        field: { 
          type: String, 
          enum: ['email', 'phone', 'name', 'company', 'tags', 'lastActivity', 'status', 'segment', 'responseCount', 'avgRating', 'createdAt'],
          required: true 
        },
        operator: { 
          type: String, 
          enum: ['equals', 'notEquals', 'contains', 'notContains', 'exists', 'greaterThan', 'lessThan', 'in', 'notIn', 'before', 'after'],
          required: true 
        },
        value: mongoose.Schema.Types.Mixed,
      }
    ]
  },

  // Pre-computed size (updated via background job)
  size: { type: Number, default: 0 },
  lastCalculated: Date,

  status: { type: String, enum: ['active', 'draft'], default: 'draft' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

smartSegmentSchema.index({ tenant: 1 });

module.exports = mongoose.model('SmartSegment', smartSegmentSchema);