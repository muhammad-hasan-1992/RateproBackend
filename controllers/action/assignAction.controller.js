// controllers/action/assignAction.controller.js
const mongoose = require("mongoose");
const Action = require("../../models/Action");
const { sendNotification } = require("../../utils/sendNotification");
const { validateUserBelongsToTenant, pushAssignmentHistory } = require("../../services/action/actionService");
const Logger = require("../../utils/logger");

/**
 * Assign action to user/team (manual override)
 */
exports.assignAction = async (req, res, next) => {
    try {
        const { assignedTo, team } = req.body;

        const action = await Action.findOne({ _id: req.params.id, tenant: req.user.tenant, isDeleted: false });
        if (!action) {
            return res.status(404).json({ success: false, message: "Action not found" });
        }

        // Permission check
        const canAssign = req.user.role === "admin" || req.user.role === "companyAdmin" ||
            (action.assignedTo && action.assignedTo.toString() === req.user._id.toString());
        if (!canAssign) {
            return res.status(403).json({ success: false, message: "Not authorized to assign this action" });
        }

        // Validate assignee
        let newAssignee = null;
        if (assignedTo) {
            newAssignee = await validateUserBelongsToTenant(assignedTo, req.user.tenant);
            if (!newAssignee) {
                return res.status(404).json({ success: false, message: "Assignee not found or not in tenant" });
            }
        }

        const oldAssignee = action.assignedTo ? action.assignedTo.toString() : null;
        const from = oldAssignee ? new mongoose.Types.ObjectId(oldAssignee) : null;

        action.assignedTo = newAssignee ? newAssignee._id : null;
        action.assignedToTeam = team || action.assignedToTeam;
        action.autoAssigned = false;

        pushAssignmentHistory(action, { from, to: action.assignedTo, toTeam: action.assignedToTeam, byUserId: req.user._id, auto: false, note: "Manual assignment" });

        await action.save();
        await action.populate({ path: "assignedTo", select: "name email avatar" });

        // Notify new assignee
        if (action.assignedTo && oldAssignee !== action.assignedTo.toString()) {
            await sendNotification({
                userId: action.assignedTo,
                type: "action_assigned",
                message: `New action assigned: ${action.description}`,
                data: { actionId: action._id, priority: action.priority }
            });
        }

        res.status(200).json({ success: true, message: "Action assigned successfully", data: action });

    } catch (err) {
        Logger.error("assignAction", "Error assigning action", {
            error: err,
            context: { actionId: req.params.id, tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error assigning action", error: err.message });
    }
};
