// services/action/actionService.js
const Action = require("../../models/Action");
const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const User = require("../../models/User");
const { sendNotification } = require("../../utils/sendNotification");
const assignmentService = require("./assignmentService");

/**
 * Validate that a user belongs to a tenant
 */
async function validateUserBelongsToTenant(userId, tenantId) {
    if (!userId) return null;
    const user = await User.findById(userId).select("_id tenant name email");
    if (!user) return null;
    if (user.tenant.toString() !== tenantId.toString()) return null;
    return user;
}

/**
 * Push assignment history entry to action
 */
function pushAssignmentHistory(action, { from, to, toTeam, byUserId, auto = false, note = null }) {
    action.assignmentHistory = action.assignmentHistory || [];
    action.assignmentHistory.push({
        from: from || null,
        to: to || null,
        toTeam: toTeam || null,
        by: byUserId,
        at: new Date(),
        auto,
        note
    });
}

/**
 * Create a new action with optional assignment rules
 */
async function createAction({ data, tenantId, userId }) {
    const { feedbackId, title, description, priority, assignedTo, team, dueDate, tags, category, source } = data;

    // Validate feedback ownership
    if (feedbackId) {
        const feedback = await FeedbackAnalysis.findById(feedbackId);
        if (!feedback || feedback.tenant.toString() !== tenantId.toString()) {
            throw { statusCode: 404, message: "Feedback not found or not in tenant" };
        }
    }

    // Validate assignee
    let validatedAssignee = null;
    if (assignedTo) {
        validatedAssignee = await validateUserBelongsToTenant(assignedTo, tenantId);
        if (!validatedAssignee) {
            throw { statusCode: 404, message: "Assignee not found or not in tenant" };
        }
    }

    // Auto due date
    const now = new Date();
    const prioritiesMap = { high: 1, medium: 7, low: 14, "long-term": 30 };
    const autoDueDate = dueDate ? new Date(dueDate) : new Date(now.getTime() + (prioritiesMap[priority] || 7) * 24 * 60 * 60 * 1000);

    const actionPayload = {
        title: title || description.substring(0, 80),
        feedback: feedbackId || null,
        description,
        priority,
        assignedTo: validatedAssignee ? validatedAssignee._id : null,
        assignedToTeam: null,
        team: team || null,
        tenant: tenantId,
        dueDate: autoDueDate,
        tags: tags || [],
        category: category || "general",
        createdBy: userId,
        source: source || "manual",
        autoAssigned: false
    };

    // Apply assignment rules if no assignee
    if (!actionPayload.assignedTo) {
        const ruleResult = await assignmentService.applyAssignmentRules(actionPayload, tenantId);
        if (ruleResult) {
            if (ruleResult.assignedTo) actionPayload.assignedTo = ruleResult.assignedTo;
            if (ruleResult.assignedToTeam) actionPayload.assignedToTeam = ruleResult.assignedToTeam;
            if (ruleResult.priority) actionPayload.priority = ruleResult.priority;
            actionPayload.autoAssigned = true;
        }
    }

    const action = await Action.create(actionPayload);

    // Push history if auto-assigned
    if (action.autoAssigned && action.assignedTo) {
        pushAssignmentHistory(action, { from: null, to: action.assignedTo, toTeam: action.assignedToTeam, byUserId: userId, auto: true, note: "Auto-assigned on create" });
        await action.save();
    }

    // Populate for response
    await action.populate([
        { path: "feedback", select: "sentiment category summary" },
        { path: "assignedTo", select: "name email" },
        { path: "createdBy", select: "name email" }
    ]);

    // Notify assignee
    if (action.assignedTo) {
        await sendNotification({
            userId: action.assignedTo,
            type: "action_assigned",
            message: `New ${action.priority} priority action assigned: ${action.description}`,
            data: { actionId: action._id, priority: action.priority, dueDate: action.dueDate }
        });
    }

    return action;
}

/**
 * Update action with validation and notifications
 */
async function updateAction({ actionId, data, tenantId, userId, userRole }) {
    const action = await Action.findOne({ _id: actionId, tenant: tenantId, isDeleted: false });
    if (!action) throw { statusCode: 404, message: "Action not found" };

    // Authorization
    const canUpdate = userRole === "admin" || userRole === "companyAdmin" ||
        (action.assignedTo && action.assignedTo.toString() === userId.toString());
    if (!canUpdate) throw { statusCode: 403, message: "Not authorized to update this action" };

    const allowed = ["description", "priority", "team", "status", "dueDate", "tags", "category", "resolution"];
    const oldStatus = action.status;

    for (const key of Object.keys(data)) {
        if (allowed.includes(key)) action[key] = data[key];
    }

    if (data.status === "resolved" && oldStatus !== "resolved") {
        action.completedAt = new Date();
        action.completedBy = userId;
    }

    await action.save();

    await action.populate([
        { path: "feedback", select: "sentiment category summary" },
        { path: "assignedTo", select: "name email avatar" },
        { path: "createdBy", select: "name email" },
        { path: "completedBy", select: "name email" }
    ]);

    // Notify on status change
    if (oldStatus !== action.status && action.assignedTo && action.assignedTo._id.toString() !== userId.toString()) {
        await sendNotification({
            userId: action.assignedTo._id,
            type: "action_status_updated",
            message: `Action status updated to: ${action.status}`,
            data: { actionId: action._id, oldStatus, newStatus: action.status }
        });
    }

    return action;
}

module.exports = {
    validateUserBelongsToTenant,
    pushAssignmentHistory,
    createAction,
    updateAction
};
