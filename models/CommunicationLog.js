// models/CommunicationLog.js
// ============================================================================
// Communication Log Model - Tracks employee notifications and follow-ups
// Requires human confirmation before sending
// ============================================================================

const mongoose = require("mongoose");

const CommunicationLogSchema = new mongoose.Schema({
    action: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Action',
        required: true
    },
    actionPlan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ActionPlan'
    },
    actionStep: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ActionStep'
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true
    },

    // Communication details
    communicationType: {
        type: String,
        enum: ['email', 'announcement', 'meeting', 'survey', 'slack', 'teams', 'other'],
        required: true
    },
    subject: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    content: {
        type: String,
        maxlength: 10000
    },

    // Recipients
    recipients: {
        type: {
            type: String,
            enum: ['all', 'department', 'segment', 'individuals'],
            default: 'all'
        },
        departments: [{ type: String }],
        userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        segmentCriteria: { type: mongoose.Schema.Types.Mixed },
        estimatedCount: { type: Number, default: 0 },
        actualCount: { type: Number } // Populated after send
    },

    // Status workflow - REQUIRES HUMAN CONFIRMATION
    status: {
        type: String,
        enum: ['draft', 'pending_confirmation', 'scheduled', 'sent', 'failed', 'cancelled'],
        default: 'draft'
    },

    // Human confirmation tracking (critical for client trust)
    confirmedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    confirmedAt: { type: Date },

    // Scheduling
    scheduledFor: { type: Date },

    // Sending
    sentAt: { type: Date },
    sentBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Error tracking
    failedAt: { type: Date },
    failureReason: { type: String },
    retryCount: { type: Number, default: 0 },

    // Follow-up survey tracking
    followUpSurveyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Survey'
    },
    followUpScheduledAt: { type: Date },

    // Attachments
    attachments: [{
        filename: { type: String },
        url: { type: String },
        mimeType: { type: String },
        size: { type: Number }
    }],

    // Template reference (if used)
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailTemplate'
    },

    // Metadata
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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

// Lookup by action
CommunicationLogSchema.index({ action: 1 });

// Lookup by action plan
CommunicationLogSchema.index({ actionPlan: 1 });

// Tenant + status for filtering
CommunicationLogSchema.index({ tenant: 1, status: 1 });

// Scheduled communications
CommunicationLogSchema.index({ tenant: 1, status: 1, scheduledFor: 1 });

// Creator lookup
CommunicationLogSchema.index({ tenant: 1, createdBy: 1 });

// ============================================================================
// Virtuals
// ============================================================================

// Check if communication is pending confirmation
CommunicationLogSchema.virtual('isPendingConfirmation').get(function () {
    return this.status === 'pending_confirmation';
});

// Get status display label
CommunicationLogSchema.virtual('statusLabel').get(function () {
    const labels = {
        'draft': 'Draft',
        'pending_confirmation': 'Pending Confirmation',
        'scheduled': 'Scheduled',
        'sent': 'Sent',
        'failed': 'Failed',
        'cancelled': 'Cancelled'
    };
    return labels[this.status] || this.status;
});

// ============================================================================
// Pre-save Middleware
// ============================================================================

CommunicationLogSchema.pre('save', function (next) {
    // Set sentAt when status changes to sent
    if (this.isModified('status') && this.status === 'sent' && !this.sentAt) {
        this.sentAt = new Date();
    }

    // Set failedAt when status changes to failed
    if (this.isModified('status') && this.status === 'failed' && !this.failedAt) {
        this.failedAt = new Date();
    }

    next();
});

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Get communications for an action
 */
CommunicationLogSchema.statics.getByAction = function (actionId) {
    return this.find({
        action: actionId,
        isDeleted: false
    }).populate([
        { path: 'sentBy', select: 'name email' },
        { path: 'confirmedBy', select: 'name email' },
        { path: 'followUpSurveyId', select: 'title status' }
    ]).sort({ createdAt: -1 });
};

/**
 * Get pending confirmations for a tenant
 */
CommunicationLogSchema.statics.getPendingConfirmations = function (tenantId) {
    return this.find({
        tenant: tenantId,
        status: 'pending_confirmation',
        isDeleted: false
    }).populate([
        { path: 'action', select: 'title priority' },
        { path: 'createdBy', select: 'name email' }
    ]).sort({ createdAt: -1 });
};

/**
 * Get scheduled communications due for sending
 */
CommunicationLogSchema.statics.getScheduledForSending = function () {
    return this.find({
        status: 'scheduled',
        scheduledFor: { $lte: new Date() },
        isDeleted: false
    }).populate([
        { path: 'tenant', select: 'name' },
        { path: 'sentBy', select: 'name email' }
    ]);
};

/**
 * Get communication history summary for an action
 */
CommunicationLogSchema.statics.getSummaryByAction = async function (actionId) {
    const logs = await this.find({
        action: actionId,
        isDeleted: false
    });

    return {
        total: logs.length,
        sent: logs.filter(l => l.status === 'sent').length,
        pending: logs.filter(l => ['draft', 'pending_confirmation', 'scheduled'].includes(l.status)).length,
        failed: logs.filter(l => l.status === 'failed').length,
        lastSentAt: logs.filter(l => l.status === 'sent').sort((a, b) => b.sentAt - a.sentAt)[0]?.sentAt || null
    };
};

module.exports = mongoose.model('CommunicationLog', CommunicationLogSchema);
