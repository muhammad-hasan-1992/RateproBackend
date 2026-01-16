// controllers/action/createAction.controller.js
const { createActionSchema } = require("../../validators/actionValidator");
const actionService = require("../../services/action/actionService");
const Logger = require("../../utils/logger");

/**
 * Create a new action
 */
exports.createAction = async (req, res, next) => {
    try {
        const { error, value } = createActionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const action = await actionService.createAction({
            data: value,
            tenantId: req.user.tenant,
            userId: req.user._id
        });

        res.status(201).json({ success: true, message: "Action created successfully", data: action });

    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        Logger.error("createAction", "Error creating action", {
            error: err,
            context: { body: req.body, userId: req.user?._id },
            req
        });
        res.status(500).json({ success: false, message: "Error creating action", error: err.message });
    }
};
