// controllers/action/getActionsByStatus.controller.js
const Action = require("../../models/Action");
const Logger = require("../../utils/logger");

/**
 * Get actions filtered by status
 */
exports.getActionsByStatus = async (req, res, next) => {
    try {
        const { status } = req.params;
        if (!["pending", "open", "in-progress", "resolved"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const actions = await Action.find({ tenant: req.user.tenant, status, isDeleted: false })
            .populate([
                { path: "assignedTo", select: "name email avatar" },
                { path: "feedback", select: "sentiment category" }
            ])
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: actions });

    } catch (err) {
        Logger.error("getActionsByStatus", "Error", {
            error: err,
            context: { tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
    }
};
