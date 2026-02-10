// models/ActionStep.js
// ============================================================================
// Action Step Model - Checklist items for ActionPlan
// Supports step types: review, analysis, action, communication, measurement
// ============================================================================

const mongoose = require("mongoose");

const ActionStepSchema = new mongoose.Schema({
    actionPlan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ActionPlan',
        required: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true
    },

    // Step definition
    stepNumber: {
        type: Number,
        required: true,
        min: 1
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    description: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    stepType: {
        type: String,
        enum: ['review', 'analysis', 'action', 'communication', 'measurement'],
        required: true
    },

    // Status tracking
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'skipped'],
        default: 'pending'
    },
    isRequired: {
        type: Boolean,
        default: true
    },

    // Ownership (optional - can inherit from ActionPlan)
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Timeline
    dueDate: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Completion details
    notes: {
        type: String,
        maxlength: 2000
    },
    attachments: [{
        filename: { type: String },
        url: { type: String },
        mimeType: { type: String },
        size: { type: Number },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],

    // Communication step specific (for stepType: 'communication')
    communicationLogId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CommunicationLog'
    },

    // Measurement step specific (for stepType: 'measurement')
    followUpSurveyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Survey'
    },

    // Skip tracking
    skippedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    skippedAt: { type: Date },
    skipReason: { type: String }

}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================================================
// Indexes
// ============================================================================

// Lookup by actionPlan
ActionStepSchema.index({ actionPlan: 1, stepNumber: 1 });

// Tenant + status for filtering
ActionStepSchema.index({ tenant: 1, status: 1 });

// Assigned user lookup
ActionStepSchema.index({ tenant: 1, assignedTo: 1, status: 1 });

// Due date tracking
ActionStepSchema.index({ tenant: 1, dueDate: 1 });

// ============================================================================
// Virtuals
// ============================================================================

// Check if step is overdue
ActionStepSchema.virtual('isOverdue').get(function () {
    if (!this.dueDate) return false;
    if (['completed', 'skipped'].includes(this.status)) return false;
    return new Date() > this.dueDate;
});

// Get step type display label
ActionStepSchema.virtual('stepTypeLabel').get(function () {
    const labels = {
        'review': 'Review',
        'analysis': 'Analysis',
        'action': 'Action',
        'communication': 'Communication',
        'measurement': 'Measurement'
    };
    return labels[this.stepType] || this.stepType;
});

// ============================================================================
// Pre-save Middleware
// ============================================================================

ActionStepSchema.pre('save', function (next) {
    // Set startedAt when status changes to in_progress
    if (this.isModified('status') && this.status === 'in_progress' && !this.startedAt) {
        this.startedAt = new Date();
    }

    // Set completedAt when status changes to completed
    if (this.isModified('status') && this.status === 'completed' && !this.completedAt) {
        this.completedAt = new Date();
    }

    // Set skippedAt when status changes to skipped
    if (this.isModified('status') && this.status === 'skipped' && !this.skippedAt) {
        this.skippedAt = new Date();
    }

    next();
});

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Get all steps for an action plan
 */
ActionStepSchema.statics.getByActionPlan = function (actionPlanId) {
    return this.find({ actionPlan: actionPlanId })
        .populate([
            { path: 'assignedTo', select: 'name email avatar' },
            { path: 'completedBy', select: 'name email' }
        ])
        .sort({ stepNumber: 1 });
};

/**
 * Create default checklist for an action plan
 */
ActionStepSchema.statics.createDefaultChecklist = async function (actionPlanId, tenantId) {
    const DEFAULT_STEPS = [
        { stepNumber: 1, title: 'Review survey comments', stepType: 'review', isRequired: true },
        { stepNumber: 2, title: 'Identify root cause', stepType: 'analysis', isRequired: true },
        { stepNumber: 3, title: 'Define corrective action', stepType: 'action', isRequired: true },
        { stepNumber: 4, title: 'Communicate plan to employees', stepType: 'communication', isRequired: true },
        { stepNumber: 5, title: 'Measure follow-up sentiment', stepType: 'measurement', isRequired: false }
    ];

    const steps = DEFAULT_STEPS.map(step => ({
        ...step,
        actionPlan: actionPlanId,
        tenant: tenantId
    }));

    return this.insertMany(steps);
};

/**
 * Calculate progress for an action plan
 */
ActionStepSchema.statics.calculateProgress = async function (actionPlanId) {
    const steps = await this.find({ actionPlan: actionPlanId });

    const totalSteps = steps.length;
    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const skippedSteps = steps.filter(s => s.status === 'skipped').length;
    const percentComplete = totalSteps > 0
        ? Math.round(((completedSteps + skippedSteps) / totalSteps) * 100)
        : 0;

    // Find current step (first non-completed, non-skipped)
    const sortedSteps = steps.sort((a, b) => a.stepNumber - b.stepNumber);
    const currentStep = sortedSteps.find(s => !['completed', 'skipped'].includes(s.status));
    const currentStepNumber = currentStep ? currentStep.stepNumber : totalSteps;

    return {
        totalSteps,
        completedSteps,
        skippedSteps,
        percentComplete,
        currentStepNumber,
        currentStepTitle: currentStep?.title || 'All steps complete'
    };
};

/**
 * Get pending steps assigned to a user
 */
ActionStepSchema.statics.getPendingByUser = function (userId, tenantId) {
    return this.find({
        tenant: tenantId,
        assignedTo: userId,
        status: { $in: ['pending', 'in_progress'] }
    }).populate([
        { path: 'actionPlan', select: 'action', populate: { path: 'action', select: 'title priority' } }
    ]).sort({ dueDate: 1, stepNumber: 1 });
};

module.exports = mongoose.model('ActionStep', ActionStepSchema);
