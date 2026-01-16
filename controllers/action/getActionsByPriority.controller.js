// controllers/action/getActionsByPriority.controller.js
const Action = require("../../models/Action");
const Logger = require("../../utils/logger");

/**
 * Get actions filtered by priority
 */
exports.getActionsByPriority = async (req, res, next) => {
    try {
        const { priority } = req.params;
        if (!["high", "medium", "low", "long-term"].includes(priority)) {
            return res.status(400).json({ success: false, message: "Invalid priority level" });
        }

        const actions = await Action.find({ tenant: req.user.tenant, priority, isDeleted: false })
            .populate([
                { path: "assignedTo", select: "name email avatar" },
                { path: "feedback", select: "sentiment category" }
            ])
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: actions });

    } catch (err) {
        Logger.error("getActionsByPriority", "Error", {
            error: err,
            context: { tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
    }
};
