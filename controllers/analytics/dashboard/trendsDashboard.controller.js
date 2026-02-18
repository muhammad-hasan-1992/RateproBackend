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
    const start = Date.now();
    try {
        const { range = '30d' } = req.query;
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({
                success: false,
                message: "Tenant context required"
            });
        }

        const days = parseInt(range.replace('d', '')) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Parallelized trend calculations
        const [satisfactionTrend, volumeTrend] = await Promise.all([
            getSatisfactionTrend(tenantId, startDate, days),
            getVolumeTrend(tenantId, startDate, days)
        ]);

        const analyticsData = {
            satisfactionTrend,
            volumeTrend,
            generatedAt: new Date()
        };

        const duration = Date.now() - start;
        if (duration > 500) {
            Logger.warn("getTrendsAnalytics", `Slow analytics endpoint: ${duration}ms`, {
                context: { tenantId, duration, range }
            });
        }

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
                userId: req.user?._id,
                duration: Date.now() - start
            },
            req
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch trends analytics"
        });
    }
});
