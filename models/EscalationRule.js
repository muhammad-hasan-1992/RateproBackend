// models/EscalationRule.js
const mongoose = require("mongoose");

/**
 * EscalationRule Schema
 * 
 * Defines rules for automatic action escalation based on SLA breaches,
 * inactivity, or priority. Each tenant can have multiple rules.
 */
const EscalationRuleSchema = new mongoose.Schema({
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Tenant",
        required: true,
        index: true
    },

    name: {
        type: String,
        required: true,
        trim: true
    },

    description: {
        type: String,
        default: null
    },

    // Trigger configuration
    trigger: {
        // Type of trigger
        type: {
            type: String,
            enum: [
                "sla_breach",           // Due date passed
                "no_progress",          // No status change for X hours
                "high_priority_stale",  // High priority action not started
                "no_assignment"         // Action unassigned for X hours
            ],
            required: true
        },
        // Hours threshold (e.g., escalate if 24 hours past due)
        thresholdHours: {
            type: Number,
            default: 24,
            min: 1
        }
    },

    // Conditions for rule to apply
    conditions: {
        // Only apply to certain priorities
        priorities: [{
            type: String,
            enum: ["high", "medium", "low", "long-term"]
        }],
        // Only apply to certain categories/departments
        categories: [String],
        // Only apply to actions from certain surveys
        surveyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Survey" }]
    },

    // Escalation action
    action: {
        // User to escalate to (usually a manager or team lead)
        escalateTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        // Or escalate to a role (find first available user with this role)
        escalateToRole: {
            type: String,
            enum: ["companyAdmin", "teamLead", null],
            default: null
        },
        // Notify the original assignee
        notifyOriginalAssignee: {
            type: Boolean,
            default: true
        },
        // Change priority on escalation
        changePriorityTo: {
            type: String,
            enum: ["high", null],
            default: null
        },
        // Add note to action
        addNote: {
            type: String,
            default: "Auto-escalated due to SLA breach"
        }
    },

    // Rule priority (higher runs first)
    priority: {
        type: Number,
        default: 0
    },

    isActive: {
        type: Boolean,
        default: true
    },

    // Track last run
    lastRunAt: {
        type: Date,
        default: null
    },

    // Statistics
    stats: {
        totalEscalations: { type: Number, default: 0 },
        lastEscalationAt: { type: Date, default: null }
    }

}, {
    timestamps: true
});

// Indexes
EscalationRuleSchema.index({ tenant: 1, isActive: 1, priority: -1 });
EscalationRuleSchema.index({ "trigger.type": 1 });

module.exports = mongoose.model("EscalationRule", EscalationRuleSchema);
