// models/LogicRule.js
const mongoose = require('mongoose');

const conditionSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  operator: {
    type: String,
    enum: ['==', '!=', '>', '<', '>=', '<=', 'contains', 'notContains', 'exists', 'in'],
    required: true
  },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

const actionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['SHOW', 'HIDE', 'REDIRECT', 'PREFILL', 'DISABLE_NEXT', 'END_SURVEY'],
    required: true
  },
  targetId: String, // questionId or sectionId
  value: mongoose.Schema.Types.Mixed
});

const logicRuleSchema = new mongoose.Schema({
  survey: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
  name: { type: String, default: 'Untitled Rule' },
  conditions: {
    logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
    items: [conditionSchema]
  },
  actions: [actionSchema],
  priority: { type: Number, default: 0 }, // higher = evaluated first
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

logicRuleSchema.index({ survey: 1 });
module.exports = mongoose.model('LogicRule', logicRuleSchema);