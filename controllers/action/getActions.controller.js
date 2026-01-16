// controllers/action/getActions.controller.js
const Action = require("../../models/Action");
const Logger = require("../../utils/logger");

/**
 * Get actions with filtering and pagination
 */
exports.getActions = async (req, res, next) => {
    try {
        const {
            page = 1, limit = 20, priority, status, assignedTo, team, category, search,
            sortBy = "createdAt", sortOrder = "desc", dateFrom, dateTo
        } = req.query;

        const filter = { tenant: req.user.tenant, isDeleted: false };

        if (priority && priority !== "all") filter.priority = priority;
        if (status && status !== "all") filter.status = status;
        if (assignedTo && assignedTo !== "all") filter.assignedTo = assignedTo;
        if (team && team !== "all") filter.team = new RegExp(team, "i");
        if (category && category !== "all") filter.category = new RegExp(category, "i");

        if (search) {
            const s = new RegExp(search, "i");
            filter.$or = [{ description: s }, { team: s }, { category: s }, { title: s }];
        }

        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
            if (dateTo) filter.createdAt.$lte = new Date(dateTo);
        }

        const skip = (page - 1) * limit;
        const sortQuery = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

        const [actions, totalActions] = await Promise.all([
            Action.find(filter)
                .populate([
                    { path: "feedback", select: "sentiment category summary" },
                    { path: "assignedTo", select: "name email avatar" },
                    { path: "createdBy", select: "name email" }
                ])
                .sort(sortQuery)
                .skip(skip)
                .limit(parseInt(limit)),
            Action.countDocuments(filter)
        ]);

        const analytics = await Action.aggregate([
            { $match: { tenant: req.user.tenant, isDeleted: false } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
                    medium: { $sum: { $cond: [{ $eq: ["$priority", "medium"] }, 1, 0] } },
                    low: { $sum: { $cond: [{ $eq: ["$priority", "low"] }, 1, 0] } },
                    longTerm: { $sum: { $cond: [{ $eq: ["$priority", "long-term"] }, 1, 0] } },
                    open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
                    inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
                    resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: {
                actions,
                pagination: { current: parseInt(page), pages: Math.ceil(totalActions / limit), total: totalActions, limit: parseInt(limit) },
                analytics: analytics[0] || { total: 0, high: 0, medium: 0, low: 0, longTerm: 0, open: 0, inProgress: 0, resolved: 0 }
            }
        });
    } catch (err) {
        Logger.error("getActions", "Error fetching actions", {
            error: err,
            context: { query: req.query, userId: req.user?._id },
            req
        });
        res.status(500).json({ success: false, message: "Error fetching actions", error: err.message });
    }
};
