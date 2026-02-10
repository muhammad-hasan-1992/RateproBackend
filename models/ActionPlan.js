// models/ActionPlan.js
// ============================================================================
// Action Plan Model - 1:1 relationship with Action (Phase 1)
// Requires human confirmation before approval
// ============================================================================

const mongoose = require("mongoose");

const ActionPlanSchema = new mongoose.Schema({
    // 1:1 relationship with Action (Phase 1 - unique constraint)
    action: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Action',
        required: true,
        unique: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true
    },

    // Core Plan (Requirement #3) - REQUIRES HUMAN CONFIRMATION
    whatWillBeDone: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },
    targetAudience: {
        type: {
            type: String,
            enum: ['all_employees', 'department', 'segment', 'individuals'],
            default: 'all_employees'
        },
        departments: [{ type: String }],
        segmentCriteria: { type: mongoose.Schema.Types.Mixed },
        estimatedCount: { type: Number, default: 0 }
    },
    expectedOutcome: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    successCriteria: [{
        type: String,
        trim: true
    }],

    // Ownership
    primaryOwner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    collaborators: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // Timeline
    plannedStartDate: { type: Date },
    plannedEndDate: { type: Date },
    actualStartDate: { type: Date },
    actualEndDate: { type: Date },

    // Status - HUMAN MUST CONFIRM BEFORE approved
    status: {
        type: String,
        enum: ['draft', 'pending_approval', 'approved', 'in_progress', 'completed', 'cancelled'],
        default: 'draft'
    },

    // Human confirmation tracking (critical for client trust)
    confirmedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    confirmedAt: { type: Date },

    // Rejection tracking
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },

    // Completion tracking
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    completedAt: { type: Date },
    completionNotes: { type: String },

    // Progress metrics (calculated from ActionSteps)
    progress: {
        totalSteps: { type: Number, default: 0 },
        completedSteps: { type: Number, default: 0 },
        percentComplete: { type: Number, default: 0 },
        currentStepNumber: { type: Number, default: 1 }
    },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================================================
// Indexes
// ============================================================================

// Enforce 1:1 relationship with Action
ActionPlanSchema.index({ action: 1 }, { unique: true });

// Tenant + status for filtering
ActionPlanSchema.index({ tenant: 1, status: 1 });

// Owner lookup
ActionPlanSchema.index({ tenant: 1, primaryOwner: 1 });

// Due date tracking
ActionPlanSchema.index({ tenant: 1, plannedEndDate: 1 });

// ============================================================================
// Virtuals
// ============================================================================

// Check if plan is overdue
ActionPlanSchema.virtual('isOverdue').get(function () {
    if (!this.plannedEndDate) return false;
    if (['completed', 'cancelled'].includes(this.status)) return false;
    return new Date() > this.plannedEndDate;
});

// Check if ready for approval
ActionPlanSchema.virtual('isReadyForApproval').get(function () {
    return this.status === 'pending_approval' &&
        this.whatWillBeDone &&
        this.expectedOutcome &&
        this.primaryOwner;
});

// ============================================================================
// Pre-save Middleware
// ============================================================================

ActionPlanSchema.pre('save', function (next) {
    // Set actualStartDate when status changes to in_progress
    if (this.isModified('status') && this.status === 'in_progress' && !this.actualStartDate) {
        this.actualStartDate = new Date();
    }

    // Set actualEndDate when status changes to completed
    if (this.isModified('status') && this.status === 'completed' && !this.actualEndDate) {
        this.actualEndDate = new Date();
    }

    next();
});

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Find action plan by action ID
 */
ActionPlanSchema.statics.findByAction = function (actionId, tenantId) {
    return this.findOne({
        action: actionId,
        tenant: tenantId,
        isDeleted: false
    });
};

/**
 * Get plans pending approval for a tenant
 */
ActionPlanSchema.statics.getPendingApproval = function (tenantId) {
    return this.find({
        tenant: tenantId,
        status: 'pending_approval',
        isDeleted: false
    }).populate([
        { path: 'action', select: 'title priority' },
        { path: 'primaryOwner', select: 'name email' }
    ]).sort({ createdAt: -1 });
};

/**
 * Get plans in progress for a user
 */
ActionPlanSchema.statics.getInProgressByOwner = function (userId, tenantId) {
    return this.find({
        tenant: tenantId,
        primaryOwner: userId,
        status: 'in_progress',
        isDeleted: false
    }).populate([
        { path: 'action', select: 'title priority dueDate' }
    ]).sort({ plannedEndDate: 1 });
};

module.exports = mongoose.model('ActionPlan', ActionPlanSchema);
