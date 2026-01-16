// controllers/analytics/dashboard/trendsDashboard.controller.js
const asyncHandler = require("express-async-handler");
const Logger = require("../../../utils/logger");
const {
    getSatisfactionTrend,
    getVolumeTrend
} = require("../../../services/analytics/dashboardService");

/**
 * Get trends analytics
 * @route GET /api/analytics/trends
 * @query range - Time range (7d, 30d, 90d) - default: 30d
 */
exports.getTrendsAnalytics = asyncHandler(async (req, res) => {
    try {
        const { range = '30d' } = req.query;
        const tenantId = req.tenantId;
        const userId = req.user?._id;

        const days = parseInt(range.replace('d', '')) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const satisfactionTrend = await getSatisfactionTrend(tenantId, startDate, days);
        const volumeTrend = await getVolumeTrend(tenantId, startDate, days);

        const analyticsData = {
            satisfactionTrend,
            volumeTrend,
            generatedAt: new Date()
        };

        return res.status(200).json({
            success: true,
            message: "Trends analytics fetched successfully",
            data: analyticsData
        });

    } catch (error) {
        Logger.error("getTrendsAnalytics", "Error fetching trends analytics", {
            error,
            context: {
                tenantId: req.tenantId || req.user?.tenant,
                userId: req.user?._id
            },
            req
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch trends analytics",
            error: error.message
        });
    }
});
