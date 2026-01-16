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
    try {
        const { range = '30d' } = req.query;
        const tenantId = req.tenantId;
        const userId = req.user?._id;

        const days = parseInt(range.replace('d', '')) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const alerts = await calculateAlertCounts(tenantId);
        const slaMetrics = await calculateSLAMetrics(tenantId, startDate);
        const topComplaints = await getTopComplaints(tenantId, startDate);
        const topPraises = await getTopPraises(tenantId, startDate);

        const dashboardData = {
            alerts,
            slaMetrics,
            topComplaints,
            topPraises,
            generatedAt: new Date()
        };

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
                userId: req.user?._id
            },
            req
        });

        return res.status(500).json({
            success: false,
            message: "Failed to fetch operational dashboard data",
            error: error.message
        });
    }
});
