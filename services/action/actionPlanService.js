// services/action/actionPlanService.js
// ============================================================================
// Action Plan Service - Business logic for action plan management
// Implements human confirmation workflow
// ============================================================================

const ActionPlan = require("../../models/ActionPlan");
const ActionStep = require("../../models/ActionStep");
const Action = require("../../models/Action");
const User = require("../../models/User");
const { sendNotification } = require("../../utils/sendNotification");
const Logger = require("../../utils/logger");

/**
 * Validate that a user belongs to a tenant
 */
async function validateUserInTenant(userId, tenantId) {
    if (!userId) return null;
    const user = await User.findById(userId).select("_id tenant name email role");
    if (!user) return null;
    if (user.tenant.toString() !== tenantId.toString()) return null;
    return user;
}

/**
 * Create a new action plan (draft status - requires confirmation)
 */
async function createActionPlan({ actionId, data, tenantId, userId }) {
    // Validate action exists and belongs to tenant
    const action = await Action.findOne({
        _id: actionId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!action) {
        throw { statusCode: 404, message: "Action not found" };
    }

    // Check if action plan already exists (1:1 relationship)
    const existingPlan = await ActionPlan.findOne({ action: actionId });
    if (existingPlan) {
        throw { statusCode: 400, message: "Action plan already exists for this action. Use update instead." };
    }

    // Validate primary owner
    const owner = await validateUserInTenant(data.primaryOwner || userId, tenantId);
    if (!owner) {
        throw { statusCode: 400, message: "Invalid primary owner" };
    }

    // Validate collaborators if provided
    let validCollaborators = [];
    if (data.collaborators && data.collaborators.length > 0) {
        for (const collabId of data.collaborators) {
            const collab = await validateUserInTenant(collabId, tenantId);
            if (collab) validCollaborators.push(collab._id);
        }
    }

    // Create action plan in draft status
    const actionPlan = await ActionPlan.create({
        action: actionId,
        tenant: tenantId,
        whatWillBeDone: data.whatWillBeDone,
        targetAudience: data.targetAudience || { type: 'all_employees' },
        expectedOutcome: data.expectedOutcome,
        successCriteria: data.successCriteria || [],
        primaryOwner: owner._id,
        collaborators: validCollaborators,
        plannedStartDate: data.plannedStartDate,
        plannedEndDate: data.plannedEndDate,
        status: 'draft' // Always start as draft - requires confirmation
    });

    // Create default checklist steps
    const steps = await ActionStep.createDefaultChecklist(actionPlan._id, tenantId);

    // Update progress
    actionPlan.progress = await ActionStep.calculateProgress(actionPlan._id);
    await actionPlan.save();

    // Update action to indicate it has a plan
    action.hasActionPlan = true;
    await action.save();

    Logger.info("createActionPlan", "Action plan created", {
        context: { actionId, actionPlanId: actionPlan._id, tenantId, createdBy: userId }
    });

    // Populate for response
    await actionPlan.populate([
        { path: 'action', select: 'title priority status' },
        { path: 'primaryOwner', select: 'name email avatar' },
        { path: 'collaborators', select: 'name email avatar' }
    ]);

    return { actionPlan, steps };
}

/**
 * Get action plan by action ID
 */
async function getActionPlanByAction(actionId, tenantId) {
    const actionPlan = await ActionPlan.findOne({
        action: actionId,
        tenant: tenantId,
        isDeleted: false
    }).populate([
        { path: 'action', select: 'title description priority status dueDate' },
        { path: 'primaryOwner', select: 'name email avatar department' },
        { path: 'collaborators', select: 'name email avatar' },
        { path: 'confirmedBy', select: 'name email' },
        { path: 'completedBy', select: 'name email' }
    ]);

    if (!actionPlan) {
        return null;
    }

    // Get steps
    const steps = await ActionStep.getByActionPlan(actionPlan._id);

    return { actionPlan, steps };
}

/**
 * Submit action plan for approval (human confirmation required)
 */
async function submitForApproval({ actionPlanId, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    if (actionPlan.status !== 'draft') {
        throw { statusCode: 400, message: `Cannot submit plan with status: ${actionPlan.status}` };
    }

    // Validate required fields
    if (!actionPlan.whatWillBeDone || !actionPlan.expectedOutcome) {
        throw { statusCode: 400, message: "Action plan must have 'what will be done' and 'expected outcome'" };
    }

    actionPlan.status = 'pending_approval';
    await actionPlan.save();

    Logger.info("submitForApproval", "Action plan submitted for approval", {
        context: { actionPlanId, tenantId, submittedBy: userId }
    });

    // TODO: Notify approvers

    return actionPlan;
}

/**
 * Confirm/approve action plan (human confirmation)
 */
async function confirmActionPlan({ actionPlanId, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    if (!['draft', 'pending_approval'].includes(actionPlan.status)) {
        throw { statusCode: 400, message: `Cannot confirm plan with status: ${actionPlan.status}` };
    }

    actionPlan.status = 'approved';
    actionPlan.confirmedBy = userId;
    actionPlan.confirmedAt = new Date();
    await actionPlan.save();

    Logger.info("confirmActionPlan", "Action plan confirmed", {
        context: { actionPlanId, tenantId, confirmedBy: userId }
    });

    // Notify owner
    if (actionPlan.primaryOwner && actionPlan.primaryOwner.toString() !== userId.toString()) {
        await sendNotification({
            userId: actionPlan.primaryOwner,
            type: "action_plan_approved",
            message: "Your action plan has been approved and is ready to execute",
            data: { actionPlanId: actionPlan._id, actionId: actionPlan.action }
        });
    }

    return actionPlan;
}

/**
 * Start execution of action plan
 */
async function startExecution({ actionPlanId, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    if (actionPlan.status !== 'approved') {
        throw { statusCode: 400, message: `Cannot start plan with status: ${actionPlan.status}. Plan must be approved first.` };
    }

    actionPlan.status = 'in_progress';
    actionPlan.actualStartDate = new Date();
    await actionPlan.save();

    // Update the parent action status
    await Action.findByIdAndUpdate(actionPlan.action, { status: 'in-progress' });

    Logger.info("startExecution", "Action plan execution started", {
        context: { actionPlanId, tenantId, startedBy: userId }
    });

    return actionPlan;
}

/**
 * Update action plan
 */
async function updateActionPlan({ actionPlanId, data, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    // Only allow updates in certain statuses
    if (['completed', 'cancelled'].includes(actionPlan.status)) {
        throw { statusCode: 400, message: `Cannot update plan with status: ${actionPlan.status}` };
    }

    const allowedFields = [
        'whatWillBeDone', 'targetAudience', 'expectedOutcome', 'successCriteria',
        'plannedStartDate', 'plannedEndDate', 'collaborators'
    ];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            actionPlan[field] = data[field];
        }
    }

    // If updating in approved/in_progress status, log the change
    if (['approved', 'in_progress'].includes(actionPlan.status)) {
        Logger.info("updateActionPlan", "Action plan modified during execution", {
            context: { actionPlanId, tenantId, modifiedBy: userId, modifiedFields: Object.keys(data) }
        });
    }

    await actionPlan.save();

    await actionPlan.populate([
        { path: 'action', select: 'title priority status' },
        { path: 'primaryOwner', select: 'name email avatar' },
        { path: 'collaborators', select: 'name email avatar' }
    ]);

    return actionPlan;
}

/**
 * Complete action plan
 */
async function completeActionPlan({ actionPlanId, data, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    if (actionPlan.status !== 'in_progress') {
        throw { statusCode: 400, message: `Cannot complete plan with status: ${actionPlan.status}` };
    }

    // Check if all required steps are complete
    const progress = await ActionStep.calculateProgress(actionPlan._id);
    const steps = await ActionStep.find({ actionPlan: actionPlanId, isRequired: true });
    const incompleteRequired = steps.filter(s => !['completed', 'skipped'].includes(s.status));

    if (incompleteRequired.length > 0) {
        throw {
            statusCode: 400,
            message: `Cannot complete plan. ${incompleteRequired.length} required step(s) are incomplete.`,
            data: { incompleteSteps: incompleteRequired.map(s => ({ stepNumber: s.stepNumber, title: s.title })) }
        };
    }

    actionPlan.status = 'completed';
    actionPlan.completedBy = userId;
    actionPlan.completedAt = new Date();
    actionPlan.actualEndDate = new Date();
    actionPlan.completionNotes = data.completionNotes;
    actionPlan.progress = progress;
    await actionPlan.save();

    // Update parent action
    await Action.findByIdAndUpdate(actionPlan.action, {
        status: 'resolved',
        completedAt: new Date(),
        completedBy: userId
    });

    Logger.info("completeActionPlan", "Action plan completed", {
        context: { actionPlanId, tenantId, completedBy: userId }
    });

    return actionPlan;
}

/**
 * Cancel action plan — resets parent action's hasActionPlan flag
 */
async function cancelActionPlan({ actionPlanId, data, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    if (['completed', 'cancelled'].includes(actionPlan.status)) {
        throw { statusCode: 400, message: `Cannot cancel plan with status: ${actionPlan.status}` };
    }

    actionPlan.status = 'cancelled';
    actionPlan.rejectedBy = userId;
    actionPlan.rejectedAt = new Date();
    actionPlan.rejectionReason = data?.reason || 'Cancelled by user';
    await actionPlan.save();

    // ── Sync hasActionPlan flag on parent action ────────────────
    await Action.findByIdAndUpdate(actionPlan.action, { hasActionPlan: false });

    Logger.info("cancelActionPlan", "Action plan cancelled", {
        context: { actionPlanId, tenantId, cancelledBy: userId }
    });

    return actionPlan;
}

/**
 * Soft-delete action plan — resets parent action's hasActionPlan flag
 */
async function softDeleteActionPlan({ actionPlanId, tenantId, userId }) {
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    actionPlan.isDeleted = true;
    actionPlan.deletedAt = new Date();
    actionPlan.deletedBy = userId;
    await actionPlan.save();

    // ── Sync hasActionPlan flag on parent action ────────────────
    await Action.findByIdAndUpdate(actionPlan.action, { hasActionPlan: false });

    Logger.info("softDeleteActionPlan", "Action plan soft-deleted", {
        context: { actionPlanId, tenantId, deletedBy: userId }
    });

    return actionPlan;
}

/**
 * Update progress metrics for an action plan
 */
async function updateProgress(actionPlanId) {
    const progress = await ActionStep.calculateProgress(actionPlanId);

    await ActionPlan.findByIdAndUpdate(actionPlanId, {
        'progress.totalSteps': progress.totalSteps,
        'progress.completedSteps': progress.completedSteps,
        'progress.percentComplete': progress.percentComplete,
        'progress.currentStepNumber': progress.currentStepNumber
    });

    return progress;
}

module.exports = {
    validateUserInTenant,
    createActionPlan,
    getActionPlanByAction,
    submitForApproval,
    confirmActionPlan,
    startExecution,
    updateActionPlan,
    completeActionPlan,
    cancelActionPlan,
    softDeleteActionPlan,
    updateProgress
};
