// controllers/action/getActionById.controller.js
const mongoose = require("mongoose");
const Action = require("../../models/Action");
const Logger = require("../../utils/logger");

/**
 * Get a single action by ID
 */
exports.getActionById = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid action id" });
        }

        const action = await Action.findOne({ _id: id, tenant: req.user.tenant, isDeleted: false })
            .populate([
                { path: "feedback", populate: { path: "survey", select: "title" } },
                { path: "assignedTo", select: "name email avatar department" },
                { path: "createdBy", select: "name email" }
            ]);

        if (!action) {
            return res.status(404).json({ success: false, message: "Action not found" });
        }

        res.status(200).json({ success: true, data: action });
    } catch (err) {
        Logger.error("getActionById", "Error fetching action", {
            error: err,
            context: { actionId: req.params.id, tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error fetching action", error: err.message });
    }
};
