// controllers/action/updateAction.controller.js
const { updateActionSchema } = require("../../validators/actionValidator");
const actionService = require("../../services/action/actionService");
const Logger = require("../../utils/logger");

/**
 * Update an action
 */
exports.updateAction = async (req, res, next) => {
    try {
        const { error, value } = updateActionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const action = await actionService.updateAction({
            actionId: req.params.id,
            data: value,
            tenantId: req.user.tenant,
            userId: req.user._id,
            userRole: req.user.role
        });

        res.status(200).json({ success: true, message: "Action updated successfully", data: action });

    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        Logger.error("updateAction", "Error updating action", {
            error: err,
            context: { actionId: req.params.id, tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error updating action", error: err.message });
    }
};
