// // models/Action.js

// const mongoose = require("mongoose");

// const ActionSchema = new mongoose.Schema({
//     title: { type: String, required: true },
//     feedback: { type: mongoose.Schema.Types.ObjectId, ref: 'FeedbackAnalysis' },
//     description: { type: String, required: true },
//     priority: { type: String, enum: ['high', 'medium', 'low', 'long-term'], required: true },
//     assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//     team: { type: String },
//     department: { type: String }, // For auto-assignment from AI analysis
//     status: { type: String, enum: ['pending', 'open', 'in-progress', 'resolved'], default: 'pending' },
//     tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

//     // Enhanced fields
//     dueDate: { type: Date },
//     completedAt: { type: Date },
//     createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Allow null for system-generated
//     completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//     category: { type: String, default: 'general' },
//     tags: [{ type: String }],
//     resolution: { type: String },

//     // Auto-generation metadata (Flow.md Section 7)
//     source: { type: String, enum: ['manual', 'survey_feedback', 'ai_generated'], default: 'manual' },
//     metadata: {
//         surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
//         responseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyResponse' },
//         sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
//         confidence: { type: Number, min: 0, max: 1 },
//         urgency: { type: String, enum: ['low', 'medium', 'high'] }
//     },

//     // Metadata
//     estimatedHours: { type: Number },
//     actualHours: { type: Number },

// }, { 
//     timestamps: true,
//     toJSON: { virtuals: true },
//     toObject: { virtuals: true }
// });

// // Indexes for performance
// ActionSchema.index({ tenant: 1, status: 1 });
// ActionSchema.index({ tenant: 1, priority: 1 });
// ActionSchema.index({ tenant: 1, assignedTo: 1 });
// ActionSchema.index({ tenant: 1, dueDate: 1 });
// ActionSchema.index({ tenant: 1, createdAt: -1 });

// // Virtual for checking if overdue
// ActionSchema.virtual('isOverdue').get(function() {
//     return this.dueDate && this.status !== 'resolved' && new Date() > this.dueDate;
// });

// // Virtual for resolution time
// ActionSchema.virtual('resolutionTime').get(function() {
//     if (this.completedAt && this.createdAt) {
//         return this.completedAt - this.createdAt;
//     }
//     return null;
// });

// // Pre-save middleware
// ActionSchema.pre('save', function(next) {
//     if (this.status === 'resolved' && !this.completedAt) {
//         this.completedAt = new Date();
//     }
//     next();
// });

// // ActionSchema.virtual('isOverdue').get(function() {
// //   return this.dueDate && 
// //          new Date(this.dueDate) < new Date() && 
// //          !['resolved', 'completed'].includes(this.status);
// // });

// module.exports = mongoose.model('Action', ActionSchema);

// models/Action.js
const mongoose = require("mongoose");

const AssignmentHistorySchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  toTeam: { type: String, default: null },
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  at: { type: Date, default: Date.now },
  auto: { type: Boolean, default: false },
  note: { type: String, default: null }
}, { _id: false });

const ActionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  feedback: { type: mongoose.Schema.Types.ObjectId, ref: 'FeedbackAnalysis' },
  description: { type: String, required: true },
  priority: { type: String, enum: ['high', 'medium', 'low', 'long-term'], required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedToTeam: { type: String, default: null }, // team-level assignment field
  team: { type: String, default: null },
  department: { type: String, default: null }, // For auto-assignment from AI analysis
  status: { type: String, enum: ['pending', 'open', 'in-progress', 'resolved'], default: 'pending' },
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

  // Enhanced fields
  dueDate: { type: Date },
  completedAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  category: { type: String, default: 'general' },
  tags: [{ type: String }],
  resolution: { type: String },

  // Auto-generation metadata
  source: { type: String, enum: ['manual', 'survey_feedback', 'ai_generated'], default: 'manual' },
  metadata: {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
    responseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyResponse' },
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
    confidence: { type: Number, min: 0, max: 1 },
    urgency: { type: String, enum: ['low', 'medium', 'high'] }
  },

  // Assignment & escalation
  autoAssigned: { type: Boolean, default: false },
  escalatedToUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignmentHistory: { type: [AssignmentHistorySchema], default: [] },

  // Metadata
  estimatedHours: { type: Number },
  actualHours: { type: Number },

  // ============================================================================
  // NEW FIELDS - Action Management Enhancement (Phase 1)
  // ============================================================================

  // Problem Framing (Requirement #1)
  problemStatement: {
    type: String,
    maxlength: 2000
  },
  affectedAudience: {
    segments: [{ type: String }],  // e.g., ["Sales Team", "Remote Workers"]
    estimatedCount: { type: Number, default: 0 }
  },

  // Root Cause Analysis (Client Requirement - Explicit)
  rootCause: {
    category: {
      type: String,
      enum: ['compensation', 'process', 'communication', 'management', 'workload', 'culture', 'resources', 'unknown'],
      default: 'unknown'
    },
    summary: { type: String, maxlength: 1000 },  // Free-text explanation
    identifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    identifiedAt: { type: Date }
  },

  // Context & Triggers (Requirement #2) - POPULATED BY ASYNC JOB
  trendData: {
    comparisonPeriod: { type: String },      // "Q3 2025"
    metricName: { type: String },            // "Compensation satisfaction"
    previousValue: { type: Number },
    currentValue: { type: Number },
    changePercent: { type: Number },
    changeDirection: { type: String, enum: ['up', 'down', 'stable'] },
    // Client requirement: "Is this new, worsening, or chronic?"
    issueStatus: {
      type: String,
      enum: ['new', 'worsening', 'improving', 'chronic', 'resolved'],
      default: 'new'
    },
    isRecurring: { type: Boolean, default: false },
    firstDetectedAt: { type: Date },
    previousSurveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },  // Link to comparison survey
    calculatedAt: { type: Date }             // Track when trend was last calculated
  },

  // Priority Rationale (Requirement #8)
  priorityReason: { type: String, maxlength: 500 },
  urgencyReason: { type: String, maxlength: 500 },

  // Supporting Evidence (Requirement #6) - Enhanced with respondentCount
  evidence: {
    responseCount: { type: Number, default: 0 },        // Total responses linked
    respondentCount: { type: Number, default: 0 },      // Unique respondents (client requirement)
    responseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SurveyResponse' }],
    commentExcerpts: [{
      text: { type: String, maxlength: 500 },
      sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
      responseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyResponse' }
    }],
    confidenceScore: { type: Number, min: 0, max: 100 }
  },

  // Migration flag for existing actions (Phase 1 soft migration)
  legacyAction: { type: Boolean, default: false },

  // Has action plan created
  hasActionPlan: { type: Boolean, default: false },

  // ============================================================================
  // END NEW FIELDS
  // ============================================================================

  // Soft-delete
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
ActionSchema.index({ tenant: 1, status: 1 });
ActionSchema.index({ tenant: 1, priority: 1 });
ActionSchema.index({ tenant: 1, assignedTo: 1 });
ActionSchema.index({ tenant: 1, dueDate: 1 });
ActionSchema.index({ tenant: 1, createdAt: -1 });

// Virtual for checking if overdue
ActionSchema.virtual('isOverdue').get(function () {
  return this.dueDate && this.status !== 'resolved' && new Date() > this.dueDate;
});

// Virtual for resolution time
ActionSchema.virtual('resolutionTime').get(function () {
  if (this.completedAt && this.createdAt) {
    return this.completedAt - this.createdAt;
  }
  return null;
});

// Pre-save middleware: resolve completedAt if status changed to resolved
ActionSchema.pre('save', function (next) {
  if (this.status === 'resolved' && !this.completedAt) {
    this.completedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Action', ActionSchema);