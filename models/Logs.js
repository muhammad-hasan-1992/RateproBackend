const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['INFO', 'WARN', 'ERROR', 'DEBUG'],
    default: 'INFO',
    index: true
  },

  // Structured action type for survey audit trail
  action: {
    type: String,
    enum: [
      'survey:delete', 'survey:activate', 'survey:deactivate',
      'survey:create', 'survey:update', 'survey:publish',
      'user:create', 'user:update', 'user:delete',
      null // Allow null for legacy logs
    ],
    default: null,
    index: true
  },

  functionName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  message: {
    type: String,
    required: true
  },

  context: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  surveyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Survey',
    index: true
  },

  // Department context for audit trail
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    index: true
  },

  // Tenant context for audit trail
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    index: true
  },

  ipAddress: String,
  userAgent: String,

  stackTrace: String

}, { timestamps: true });

// Compound index for efficient audit queries
logSchema.index({ action: 1, tenantId: 1, createdAt: -1 });
logSchema.index({ surveyId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', logSchema);
