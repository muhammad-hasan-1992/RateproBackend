// controllers/action/getActionsAnalytics.controller.js
const Action = require("../../models/Action");
const Logger = require("../../utils/logger");

/**
 * Get action analytics summary
 */
exports.getActionsAnalytics = async (req, res, next) => {
    try {
        const { period = "30" } = req.query;
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(period));

        const analytics = await Action.aggregate([
            { $match: { tenant: req.user.tenant, createdAt: { $gte: daysAgo }, isDeleted: false } },
            {
                $facet: {
                    byPriority: [
                        { $group: { _id: "$priority", count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } }
                    ],
                    byStatus: [
                        { $group: { _id: "$status", count: { $sum: 1 } } }
                    ],
                    byTeam: [
                        { $group: { _id: "$team", count: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } },
                        { $sort: { count: -1 } },
                        { $limit: 10 }
                    ],
                    timeline: [
                        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, created: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } },
                        { $sort: { _id: 1 } }
                    ],
                    overdue: [
                        { $match: { dueDate: { $lt: new Date() }, status: { $ne: "resolved" } } },
                        { $count: "total" }
                    ],
                    avgResolutionTime: [
                        { $match: { status: "resolved", completedAt: { $exists: true } } },
                        { $project: { resolutionTime: { $subtract: ["$completedAt", "$createdAt"] } } },
                        { $group: { _id: null, avgTime: { $avg: "$resolutionTime" } } }
                    ]
                }
            }
        ]);

        const result = analytics[0] || {};

        res.status(200).json({
            success: true,
            data: {
                byPriority: result.byPriority || [],
                byStatus: result.byStatus || [],
                byTeam: result.byTeam || [],
                timeline: result.timeline || [],
                overdue: result.overdue?.[0]?.total || 0,
                avgResolutionTime: result.avgResolutionTime?.[0]?.avgTime || 0,
                period: parseInt(period)
            }
        });

    } catch (err) {
        Logger.error("getActionsAnalytics", "Error", {
            error: err,
            context: { tenant: req.user.tenant },
            req
        });
        res.status(500).json({ success: false, message: "Error fetching analytics", error: err.message });
    }
};
