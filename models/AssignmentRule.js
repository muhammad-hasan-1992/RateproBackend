// models/AssignmentRule.js
const mongoose = require('mongoose');

const assignmentRuleSchema = new mongoose.Schema({
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: String,
  conditions: [{
    field: { 
      type: String, 
      enum: ['category', 'survey', 'department', 'location', 'rating', 'keyword', 'score'],
      required: true 
    },
    operator: { type: String, enum: ['==', '!=', 'in', 'contains', '<=', '>='] },
    value: mongoose.Schema.Types.Mixed
  }],
  logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
  
  assignment: {
    mode: { type: String, enum: ['user', 'team_roundrobin', 'team_leastload'], default: 'user' },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetTeam: String,
  },
  
  priorityOverride: { type: String, enum: ['high', 'medium', 'low'] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

assignmentRuleSchema.index({ tenant: 1 });
module.exports = mongoose.model('AssignmentRule', assignmentRuleSchema);