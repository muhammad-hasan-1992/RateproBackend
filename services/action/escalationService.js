// services/action/escalationService.js
const Action = require("../../models/Action");
const EscalationRule = require("../../models/EscalationRule");
const User = require("../../models/User");
const Tenant = require("../../models/Tenant");
const { sendNotification } = require("../../utils/sendNotification");
const { pushAssignmentHistory } = require("./actionService");
const Logger = require("../../utils/logger");

/**
 * Check all tenants for actions that need escalation
 */
async function checkAllTenantsForEscalation() {
    try {
        const tenants = await Tenant.find({ isActive: true }).select("_id name").lean();

        let totalEscalated = 0;
        for (const tenant of tenants) {
            const count = await checkAndEscalateActions(tenant._id);
            totalEscalated += count;
        }

        Logger.info("escalationCron", `Escalation check complete`, {
            context: { tenantsChecked: tenants.length, totalEscalated }
        });

        return totalEscalated;
    } catch (error) {
        Logger.error("escalationCron", "Error in escalation check", { error });
        throw error;
    }
}

/**
 * Check and escalate actions for a specific tenant
 * @param {ObjectId} tenantId
 * @returns {number} Number of actions escalated
 */
async function checkAndEscalateActions(tenantId) {
    const rules = await EscalationRule.find({
        tenant: tenantId,
        isActive: true
    }).sort({ priority: -1 }).lean();

    if (rules.length === 0) return 0;

    let escalatedCount = 0;

    for (const rule of rules) {
        const actionsToEscalate = await findActionsMatchingRule(rule, tenantId);

        for (const action of actionsToEscalate) {
            const success = await escalateAction(action, rule);
            if (success) escalatedCount++;
        }

        // Update rule stats
        if (actionsToEscalate.length > 0) {
            await EscalationRule.findByIdAndUpdate(rule._id, {
                lastRunAt: new Date(),
                $inc: { "stats.totalEscalations": actionsToEscalate.length },
                "stats.lastEscalationAt": new Date()
            });
        }
    }

    return escalatedCount;
}

/**
 * Find actions that match escalation rule criteria
 */
async function findActionsMatchingRule(rule, tenantId) {
    const now = new Date();
    const thresholdMs = (rule.trigger.thresholdHours || 24) * 60 * 60 * 1000;
    const thresholdDate = new Date(now.getTime() - thresholdMs);

    const query = {
        tenant: tenantId,
        isDeleted: false,
        escalatedToUser: null, // Not already escalated
        status: { $nin: ["resolved"] }
    };

    // Apply trigger type conditions
    switch (rule.trigger.type) {
        case "sla_breach":
            // Due date passed + threshold hours
            query.dueDate = { $lt: thresholdDate };
            break;

        case "no_progress":
            // No updates for threshold hours
            query.updatedAt = { $lt: thresholdDate };
            query.status = { $in: ["pending", "open"] };
            break;

        case "high_priority_stale":
            // High priority not started for threshold hours
            query.priority = "high";
            query.status = "pending";
            query.createdAt = { $lt: thresholdDate };
            break;

        case "no_assignment":
            // Unassigned for threshold hours
            query.assignedTo = null;
            query.createdAt = { $lt: thresholdDate };
            break;
    }

    // Apply condition filters
    if (rule.conditions?.priorities?.length > 0) {
        query.priority = { $in: rule.conditions.priorities };
    }

    if (rule.conditions?.categories?.length > 0) {
        query.category = { $in: rule.conditions.categories };
    }

    if (rule.conditions?.surveyIds?.length > 0) {
        query["metadata.surveyId"] = { $in: rule.conditions.surveyIds };
    }

    return Action.find(query).limit(50).lean();
}

/**
 * Escalate a single action
 */
async function escalateAction(action, rule) {
    try {
        // Determine escalation target
        let escalateToUser = null;

        if (rule.action.escalateTo) {
            escalateToUser = await User.findById(rule.action.escalateTo)
                .select("_id name email tenant")
                .lean();
        } else if (rule.action.escalateToRole) {
            // Find first active user with the escalation role in this tenant
            escalateToUser = await User.findOne({
                tenant: action.tenant,
                role: rule.action.escalateToRole,
                isActive: true,
                deleted: false
            }).select("_id name email").lean();
        }

        if (!escalateToUser) {
            Logger.warn("escalateAction", "No escalation target found", {
                context: { actionId: action._id, ruleId: rule._id }
            });
            return false;
        }

        // Update action
        const updateData = {
            escalatedToUser: escalateToUser._id,
            autoAssigned: false
        };

        // Optionally change priority
        if (rule.action.changePriorityTo) {
            updateData.priority = rule.action.changePriorityTo;
        }

        // Create assignment history entry
        const historyEntry = {
            from: action.assignedTo || null,
            to: escalateToUser._id,
            toTeam: null,
            by: null, // System
            at: new Date(),
            auto: true,
            note: rule.action.addNote || `Auto-escalated: ${rule.name}`
        };

        await Action.findByIdAndUpdate(action._id, {
            $set: updateData,
            $push: { assignmentHistory: historyEntry }
        });

        // Send notification to escalation target
        await sendNotification({
            userId: escalateToUser._id,
            type: "action_escalated",
            title: "Action Escalated to You",
            message: `Action "${action.title}" has been escalated to you due to ${formatTriggerType(rule.trigger.type)}.`,
            data: {
                actionId: action._id,
                priority: updateData.priority || action.priority,
                ruleId: rule._id,
                originalAssignee: action.assignedTo
            }
        });

        // Notify original assignee if configured
        if (rule.action.notifyOriginalAssignee && action.assignedTo) {
            await sendNotification({
                userId: action.assignedTo,
                type: "action_escalated",
                title: "Action Escalated",
                message: `Action "${action.title}" has been escalated due to ${formatTriggerType(rule.trigger.type)}.`,
                data: {
                    actionId: action._id,
                    escalatedTo: escalateToUser._id
                }
            });
        }

        Logger.info("escalateAction", "Action escalated successfully", {
            context: {
                actionId: action._id,
                ruleId: rule._id,
                escalatedTo: escalateToUser._id
            }
        });

        return true;
    } catch (error) {
        Logger.error("escalateAction", "Failed to escalate action", {
            error,
            context: { actionId: action._id, ruleId: rule._id }
        });
        return false;
    }
}

/**
 * Format trigger type for notification message
 */
function formatTriggerType(type) {
    const messages = {
        sla_breach: "SLA breach (overdue)",
        no_progress: "no progress",
        high_priority_stale: "high priority action not started",
        no_assignment: "no assignment"
    };
    return messages[type] || type;
}

module.exports = {
    checkAllTenantsForEscalation,
    checkAndEscalateActions,
    escalateAction
};
