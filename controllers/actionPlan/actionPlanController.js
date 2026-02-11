// controllers/actionPlan/actionPlanController.js
// ============================================================================
// Action Plan Controller - HTTP handlers for action plan management
// Implements human confirmation workflow
// ============================================================================

const actionPlanService = require("../../services/action/actionPlanService");
const actionStepService = require("../../services/action/actionStepService");
const Logger = require("../../utils/logger");

/**
 * Create action plan for an action
 * POST /api/actions/:actionId/plan
 */
exports.createActionPlan = async (req, res) => {
    try {
        // Route param is :id (from actionRoutes.js: /:id/plan)
        const actionId = req.params.id;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const result = await actionPlanService.createActionPlan({
            actionId,
            data: req.body,
            tenantId,
            userId
        });

        res.status(201).json({
            success: true,
            message: "Action plan created in draft status. Please confirm to approve.",
            data: result
        });
    } catch (err) {
        Logger.error("createActionPlan", "Failed to create action plan", {
            error: err,
            context: { actionId: req.params.actionId, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to create action plan"
        });
    }
};

/**
 * Get action plan by action ID
 * GET /api/actions/:actionId/plan
 */
exports.getActionPlan = async (req, res) => {
    try {
        // Route param is :id (from actionRoutes.js: /:id/plan)
        const actionId = req.params.id;
        const tenantId = req.tenantId || req.user.tenant;

        const result = await actionPlanService.getActionPlanByAction(actionId, tenantId);

        // Return 200 with null data when no plan exists (not 404).
        // The action resource exists — it simply has no plan yet.
        // 404 should mean "this URL/resource doesn't exist at all".
        if (!result) {
            return res.status(200).json({
                success: true,
                data: {
                    actionPlan: null,
                    steps: [],
                    message: "No action plan created yet for this action"
                }
            });
        }

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (err) {
        Logger.error("getActionPlan", "Failed to get action plan", {
            error: err,
            context: { actionId: req.params.actionId, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to get action plan"
        });
    }
};

/**
 * Submit action plan for approval
 * POST /api/action-plans/:id/submit
 */
exports.submitForApproval = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const actionPlan = await actionPlanService.submitForApproval({
            actionPlanId: id,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Action plan submitted for approval",
            data: actionPlan
        });
    } catch (err) {
        Logger.error("submitForApproval", "Failed to submit action plan", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to submit action plan"
        });
    }
};

/**
 * Confirm/approve action plan (human confirmation)
 * POST /api/action-plans/:id/confirm
 */
exports.confirmActionPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const actionPlan = await actionPlanService.confirmActionPlan({
            actionPlanId: id,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Action plan confirmed and approved",
            data: actionPlan
        });
    } catch (err) {
        Logger.error("confirmActionPlan", "Failed to confirm action plan", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to confirm action plan"
        });
    }
};

/**
 * Start action plan execution
 * POST /api/action-plans/:id/start
 */
exports.startExecution = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const actionPlan = await actionPlanService.startExecution({
            actionPlanId: id,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Action plan execution started",
            data: actionPlan
        });
    } catch (err) {
        Logger.error("startExecution", "Failed to start action plan", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to start action plan"
        });
    }
};

/**
 * Update action plan
 * PUT /api/action-plans/:id
 */
exports.updateActionPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const actionPlan = await actionPlanService.updateActionPlan({
            actionPlanId: id,
            data: req.body,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Action plan updated",
            data: actionPlan
        });
    } catch (err) {
        Logger.error("updateActionPlan", "Failed to update action plan", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to update action plan"
        });
    }
};

/**
 * Complete action plan
 * POST /api/action-plans/:id/complete
 */
exports.completeActionPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const actionPlan = await actionPlanService.completeActionPlan({
            actionPlanId: id,
            data: req.body,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Action plan completed successfully",
            data: actionPlan
        });
    } catch (err) {
        Logger.error("completeActionPlan", "Failed to complete action plan", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to complete action plan"
        });
    }
};

// ============================================================================
// Action Step Endpoints
// ============================================================================

/**
 * Get steps for an action plan
 * GET /api/action-plans/:id/steps
 */
exports.getSteps = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;

        const result = await actionStepService.getStepsByActionPlan(id, tenantId);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (err) {
        Logger.error("getSteps", "Failed to get steps", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to get steps"
        });
    }
};

/**
 * Update step status
 * PUT /api/action-steps/:stepId/status
 */
exports.updateStepStatus = async (req, res) => {
    try {
        const { stepId } = req.params;
        const { status, notes, skipReason } = req.body;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const step = await actionStepService.updateStepStatus({
            stepId,
            status,
            data: { notes, skipReason },
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: `Step ${status === 'completed' ? 'completed' : status === 'skipped' ? 'skipped' : 'updated'}`,
            data: step
        });
    } catch (err) {
        Logger.error("updateStepStatus", "Failed to update step status", {
            error: err,
            context: { stepId: req.params.stepId, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to update step status"
        });
    }
};

/**
 * Add custom step
 * POST /api/action-plans/:id/steps
 */
exports.addStep = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const step = await actionStepService.addCustomStep({
            actionPlanId: id,
            data: req.body,
            tenantId,
            userId
        });

        res.status(201).json({
            success: true,
            message: "Step added",
            data: step
        });
    } catch (err) {
        Logger.error("addStep", "Failed to add step", {
            error: err,
            context: { actionPlanId: req.params.id, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to add step"
        });
    }
};

/**
 * Update step details
 * PUT /api/action-steps/:stepId
 */
exports.updateStep = async (req, res) => {
    try {
        const { stepId } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        const step = await actionStepService.updateStep({
            stepId,
            data: req.body,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Step updated",
            data: step
        });
    } catch (err) {
        Logger.error("updateStep", "Failed to update step", {
            error: err,
            context: { stepId: req.params.stepId, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to update step"
        });
    }
};

/**
 * Delete step
 * DELETE /api/action-steps/:stepId
 */
exports.deleteStep = async (req, res) => {
    try {
        const { stepId } = req.params;
        const tenantId = req.tenantId || req.user.tenant;
        const userId = req.user._id;

        await actionStepService.deleteStep({
            stepId,
            tenantId,
            userId
        });

        res.status(200).json({
            success: true,
            message: "Step deleted"
        });
    } catch (err) {
        Logger.error("deleteStep", "Failed to delete step", {
            error: err,
            context: { stepId: req.params.stepId, tenantId: req.tenantId },
            req
        });

        res.status(err.statusCode || 500).json({
            success: false,
            message: err.message || "Failed to delete step"
        });
    }
};
