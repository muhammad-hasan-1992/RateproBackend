// controllers/action/deleteAction.controller.js
const Action = require("../../models/Action");
const Logger = require("../../utils/logger");

/**
 * Soft-delete an action
 */
exports.deleteAction = async (req, res, next) => {
    try {
        const action = await Action.findOne({ _id: req.params.id, tenant: req.user.tenant, isDeleted: false });
        if (!action) {
            return res.status(404).json({ success: false, message: "Action not found" });
        }

        // Only admin/companyAdmin can delete
        if (!(req.user.role === "admin" || req.user.role === "companyAdmin")) {
            return res.status(403).json({ success: false, message: "Not authorized to delete action" });
        }

        action.isDeleted = true;
        action.deletedAt = new Date();
        action.deletedBy = req.user._id;
        await action.save();

        res.status(200).json({ success: true, message: "Action deleted successfully (soft-delete)" });

    } catch (err) {
        Logger.error("deleteAction", "Error deleting action", {
            error: err,
            context: { actionId: req.params.id, tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error deleting action", error: err.message });
    }
};
