// services/action/actionStepService.js
// ============================================================================
// Action Step Service - Business logic for checklist step management
// ============================================================================

const ActionStep = require("../../models/ActionStep");
const ActionPlan = require("../../models/ActionPlan");
const actionPlanService = require("./actionPlanService");
const Logger = require("../../utils/logger");

/**
 * Get all steps for an action plan
 */
async function getStepsByActionPlan(actionPlanId, tenantId) {
    // Validate action plan belongs to tenant
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    const steps = await ActionStep.getByActionPlan(actionPlanId);
    const progress = await ActionStep.calculateProgress(actionPlanId);

    return { steps, progress };
}

/**
 * Update a step's status
 */
async function updateStepStatus({ stepId, status, data, tenantId, userId }) {
    const step = await ActionStep.findOne({
        _id: stepId,
        tenant: tenantId
    });

    if (!step) {
        throw { statusCode: 404, message: "Step not found" };
    }

    // Validate action plan is in progress
    const actionPlan = await ActionPlan.findById(step.actionPlan);
    if (!actionPlan || actionPlan.status !== 'in_progress') {
        throw { statusCode: 400, message: "Cannot update step. Action plan is not in progress." };
    }

    const previousStatus = step.status;
    step.status = status;

    // Handle status-specific fields
    if (status === 'in_progress' && !step.startedAt) {
        step.startedAt = new Date();
    }

    if (status === 'completed') {
        step.completedAt = new Date();
        step.completedBy = userId;
        if (data.notes) step.notes = data.notes;
    }

    if (status === 'skipped') {
        step.skippedAt = new Date();
        step.skippedBy = userId;
        step.skipReason = data.skipReason || 'Skipped by user';

        // Cannot skip required steps without reason
        if (step.isRequired && !data.skipReason) {
            throw { statusCode: 400, message: "Required steps cannot be skipped without a reason" };
        }
    }

    await step.save();

    // Update action plan progress
    await actionPlanService.updateProgress(step.actionPlan);

    Logger.info("updateStepStatus", "Step status updated", {
        context: {
            stepId,
            previousStatus,
            newStatus: status,
            tenantId,
            updatedBy: userId
        }
    });

    // Populate for response
    await step.populate([
        { path: 'assignedTo', select: 'name email avatar' },
        { path: 'completedBy', select: 'name email' }
    ]);

    return step;
}

/**
 * Add a custom step to an action plan
 */
async function addCustomStep({ actionPlanId, data, tenantId, userId }) {
    // Validate action plan belongs to tenant
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    // Get current max step number
    const existingSteps = await ActionStep.find({ actionPlan: actionPlanId }).sort({ stepNumber: -1 }).limit(1);
    const nextStepNumber = existingSteps.length > 0 ? existingSteps[0].stepNumber + 1 : 1;

    const step = await ActionStep.create({
        actionPlan: actionPlanId,
        tenant: tenantId,
        stepNumber: data.insertAfter ? data.insertAfter + 1 : nextStepNumber,
        title: data.title,
        description: data.description,
        stepType: data.stepType || 'action',
        isRequired: data.isRequired !== undefined ? data.isRequired : true,
        assignedTo: data.assignedTo,
        dueDate: data.dueDate
    });

    // Reorder subsequent steps if inserted in the middle
    if (data.insertAfter) {
        await ActionStep.updateMany(
            {
                actionPlan: actionPlanId,
                stepNumber: { $gte: step.stepNumber },
                _id: { $ne: step._id }
            },
            { $inc: { stepNumber: 1 } }
        );
    }

    // Update action plan progress
    await actionPlanService.updateProgress(actionPlanId);

    Logger.info("addCustomStep", "Custom step added", {
        context: { stepId: step._id, actionPlanId, tenantId, createdBy: userId }
    });

    return step;
}

/**
 * Update step details
 */
async function updateStep({ stepId, data, tenantId, userId }) {
    const step = await ActionStep.findOne({
        _id: stepId,
        tenant: tenantId
    });

    if (!step) {
        throw { statusCode: 404, message: "Step not found" };
    }

    const allowedFields = ['title', 'description', 'stepType', 'isRequired', 'assignedTo', 'dueDate', 'notes'];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            step[field] = data[field];
        }
    }

    await step.save();

    await step.populate([
        { path: 'assignedTo', select: 'name email avatar' }
    ]);

    return step;
}

/**
 * Delete a step (only allowed for custom steps)
 */
async function deleteStep({ stepId, tenantId, userId }) {
    const step = await ActionStep.findOne({
        _id: stepId,
        tenant: tenantId
    });

    if (!step) {
        throw { statusCode: 404, message: "Step not found" };
    }

    const actionPlanId = step.actionPlan;

    await ActionStep.deleteOne({ _id: stepId });

    // Reorder remaining steps
    const remainingSteps = await ActionStep.find({ actionPlan: actionPlanId }).sort({ stepNumber: 1 });
    for (let i = 0; i < remainingSteps.length; i++) {
        if (remainingSteps[i].stepNumber !== i + 1) {
            remainingSteps[i].stepNumber = i + 1;
            await remainingSteps[i].save();
        }
    }

    // Update action plan progress
    await actionPlanService.updateProgress(actionPlanId);

    Logger.info("deleteStep", "Step deleted", {
        context: { stepId, actionPlanId, tenantId, deletedBy: userId }
    });

    return { success: true };
}

/**
 * Reorder steps
 */
async function reorderSteps({ actionPlanId, stepOrder, tenantId }) {
    // Validate action plan belongs to tenant
    const actionPlan = await ActionPlan.findOne({
        _id: actionPlanId,
        tenant: tenantId,
        isDeleted: false
    });

    if (!actionPlan) {
        throw { statusCode: 404, message: "Action plan not found" };
    }

    // stepOrder is an array of step IDs in new order
    for (let i = 0; i < stepOrder.length; i++) {
        await ActionStep.findByIdAndUpdate(stepOrder[i], { stepNumber: i + 1 });
    }

    const steps = await ActionStep.getByActionPlan(actionPlanId);

    return steps;
}

module.exports = {
    getStepsByActionPlan,
    updateStepStatus,
    addCustomStep,
    updateStep,
    deleteStep,
    reorderSteps
};
