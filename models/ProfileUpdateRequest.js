// models/ProfileUpdateRequest.js
const mongoose = require("mongoose");

/**
 * Profile Update Request Schema
 *
 * Stores company/tenant profile change requests that require admin approval.
 * Personal user profile changes (name, email, phone, bio, avatar) are applied
 * directly — only company-level changes go through this approval pipeline.
 *
 * Workflow:
 * 1. CompanyAdmin submits company profile changes → status: "pending"
 * 2. System Admin reviews → approves/rejects
 * 3. If approved → changes applied atomically to Tenant model
 */

const profileUpdateRequestSchema = new mongoose.Schema(
    {
        // Who submitted the request
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Which tenant's profile is being updated
        tenant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Tenant",
            required: true,
            index: true,
        },

        // Proposed changes — field: newValue map
        proposedChanges: {
            type: mongoose.Schema.Types.Mixed,
            required: [true, "Proposed changes are required"],
        },

        // Snapshot of current values at time of request (for diff/review)
        currentValues: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },

        // Approval status
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
            index: true,
        },

        // Admin who reviewed
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        // Review timestamp
        reviewedAt: {
            type: Date,
            default: null,
        },

        // Admin's note (reason for rejection, etc)
        reviewNote: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// ============================================================================
// INDEXES
// ============================================================================

// Admin queue: pending requests sorted by date
profileUpdateRequestSchema.index({ status: 1, createdAt: -1 });

// User's own requests
profileUpdateRequestSchema.index({ requestedBy: 1, createdAt: -1 });

// Tenant lookup
profileUpdateRequestSchema.index({ tenant: 1, status: 1 });

// ============================================================================
// ALLOWED FIELDS
// ============================================================================

/**
 * Fields that can be updated through the approval workflow.
 * This whitelist prevents unauthorized field modifications.
 */
profileUpdateRequestSchema.statics.ALLOWED_FIELDS = [
    "name",
    "address",
    "contactEmail",
    "contactPhone",
    "website",
    "totalEmployees",
];

module.exports = mongoose.model("ProfileUpdateRequest", profileUpdateRequestSchema);
