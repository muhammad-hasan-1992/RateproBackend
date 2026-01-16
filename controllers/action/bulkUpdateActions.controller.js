// controllers/action/bulkUpdateActions.controller.js
const Action = require("../../models/Action");
const { bulkUpdateSchema } = require("../../validators/actionValidator");
const Logger = require("../../utils/logger");

/**
 * Bulk update multiple actions
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

        // Whitelist updates
        const allowedUpdates = {};
        if (updates.priority) allowedUpdates.priority = updates.priority;
        if (typeof updates.status !== 'undefined') allowedUpdates.status = updates.status;
        if (typeof updates.assignedTo !== 'undefined') allowedUpdates.assignedTo = updates.assignedTo;
        if (typeof updates.team !== 'undefined') allowedUpdates.team = updates.team;

        const result = await Action.updateMany(
            { _id: { $in: actionIds }, tenant: req.user.tenant },
            { $set: allowedUpdates }
        );

        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} actions updated successfully`,
            data: { modifiedCount: result.modifiedCount }
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
