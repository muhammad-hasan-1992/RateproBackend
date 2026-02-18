// controllers/analytics/dashboard/operationalDashboard.controller.js
const asyncHandler = require("express-async-handler");
const Logger = require("../../../utils/logger");
const {
    calculateAlertCounts,
    calculateSLAMetrics,
    getTopComplaints,
    getTopPraises
} = require("../../../services/analytics/dashboardService");

/**
 * Get operational dashboard analytics
 * @route GET /api/analytics/operational
 * @query range - Time range (7d, 30d, 90d) - default: 30d
 */
exports.getOperationalDashboard = asyncHandler(async (req, res) => {
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

        // Operational data calculations — parallelized for performance
        const [alerts, slaMetrics, topComplaints, topPraises] = await Promise.all([
            calculateAlertCounts(tenantId),
            calculateSLAMetrics(tenantId, startDate),
            getTopComplaints(tenantId, startDate),
            getTopPraises(tenantId, startDate)
        ]);

        const dashboardData = {
            alerts,
            slaMetrics,
            topComplaints,
            topPraises,
            generatedAt: new Date()
        };

        const duration = Date.now() - start;
        if (duration > 500) {
            Logger.warn("getOperationalDashboard", `Slow analytics endpoint: ${duration}ms`, {
                context: { tenantId, duration, range }
            });
        }

        return res.status(200).json({
            success: true,
            message: "Operational dashboard data fetched successfully",
            data: dashboardData
        });

    } catch (error) {
        Logger.error("getOperationalDashboard", "Error fetching operational dashboard data", {
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
            message: "Failed to fetch operational dashboard data"
        });
    }
});
