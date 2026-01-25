// controllers/action/bulkUpdateActions.controller.js
const Action = require("../../models/Action");
const { bulkUpdateSchema } = require("../../validators/actionValidator");
const { pushAssignmentHistory, validateUserBelongsToTenant } = require("../../services/action/actionService");
const { sendNotification } = require("../../utils/sendNotification");
const Logger = require("../../utils/logger");

/**
 * Bulk update multiple actions with audit logging
 */
exports.bulkUpdateActions = async (req, res, next) => {
    let actionIds;
    let updates;

    try {
        const { error, value } = bulkUpdateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        ({ actionIds, updates } = value);

        const actions = await Action.find({ _id: { $in: actionIds }, tenant: req.user.tenant, isDeleted: false });
        if (actions.length !== actionIds.length) {
            return res.status(404).json({ success: false, message: "Some actions not found" });
        }

        // Validate new assignee if provided
        let validatedAssignee = null;
        if (updates.assignedTo) {
            validatedAssignee = await validateUserBelongsToTenant(updates.assignedTo, req.user.tenant);
            if (!validatedAssignee) {
                return res.status(404).json({ success: false, message: "Assignee not found or not in tenant" });
            }
        }

        // Whitelist updates
        const allowedUpdates = {};
        if (updates.priority) allowedUpdates.priority = updates.priority;
        if (typeof updates.status !== 'undefined') allowedUpdates.status = updates.status;
        if (typeof updates.assignedTo !== 'undefined') allowedUpdates.assignedTo = updates.assignedTo;
        if (typeof updates.team !== 'undefined') allowedUpdates.team = updates.team;

        // If assignment is changing, add audit history for each action
        if (typeof updates.assignedTo !== 'undefined') {
            const bulkOps = actions.map(action => {
                const historyEntry = {
                    from: action.assignedTo || null,
                    to: updates.assignedTo || null,
                    toTeam: updates.team || action.assignedToTeam || null,
                    by: req.user._id,
                    at: new Date(),
                    auto: false,
                    note: `Bulk assignment by ${req.user.name || req.user.email}`
                };

                return {
                    updateOne: {
                        filter: { _id: action._id },
                        update: {
                            $set: {
                                ...allowedUpdates,
                                autoAssigned: false
                            },
                            $push: { assignmentHistory: historyEntry }
                        }
                    }
                };
            });

            await Action.bulkWrite(bulkOps);

            // Send notifications to new assignee
            if (validatedAssignee) {
                await sendNotification({
                    userId: validatedAssignee._id,
                    type: "bulk_action_assigned",
                    message: `${actions.length} actions have been assigned to you`,
                    data: { actionIds, assignedBy: req.user._id }
                });
            }
        } else {
            // No assignment change - simple update
            await Action.updateMany(
                { _id: { $in: actionIds }, tenant: req.user.tenant },
                { $set: allowedUpdates }
            );
        }

        res.status(200).json({
            success: true,
            message: `${actions.length} actions updated successfully`,
            data: { modifiedCount: actions.length }
        });

    } catch (err) {
        Logger.error("bulkUpdateActions", "Error updating actions", {
            error: err,
            context: { tenant: req.user.tenant, userId: req.user?._id, actionIds },
            req
        });
        res.status(500).json({ success: false, message: "Error updating actions", error: err.message });
    }
};

