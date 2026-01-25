// models/ActionTemplate.js
const mongoose = require("mongoose");

/**
 * Action Template Schema
 * 
 * Pre-defined templates for quick action creation.
 * Useful for recurring action types like "Follow up with customer",
 * "Escalate to manager", etc.
 */
const actionTemplateSchema = new mongoose.Schema({
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        index: true
    },

    // Template info
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ""
    },

    // Default values for actions created from this template
    defaults: {
        title: { type: String, required: true },
        description: { type: String, default: "" },
        priority: {
            type: String,
            enum: ["high", "medium", "low", "long-term"],
            default: "medium"
        },
        category: { type: String },
        status: {
            type: String,
            enum: ["pending", "open", "in-progress", "resolved"],
            default: "pending"
        },
        // Due date offset in days from creation
        dueDateOffsetDays: {
            type: Number,
            default: 7
        }
    },

    // Auto-assignment
    assignment: {
        defaultAssignee: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        defaultTeam: { type: String, default: null },
        // If true, use assignment rules instead of template default
        useRules: { type: Boolean, default: false }
    },

    // Tags for filtering
    tags: [{ type: String }],

    // Usage tracking
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },

    isActive: { type: Boolean, default: true },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }

}, { timestamps: true });

// Indexes
actionTemplateSchema.index({ tenant: 1, isActive: 1, name: 1 });
actionTemplateSchema.index({ tenant: 1, tags: 1 });

module.exports = mongoose.model("ActionTemplate", actionTemplateSchema);
