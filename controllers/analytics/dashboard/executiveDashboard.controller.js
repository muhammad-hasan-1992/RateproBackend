// controllers/analytics/dashboard/executiveDashboard.controller.js
const asyncHandler = require("express-async-handler");
const Logger = require("../../../utils/logger");
const {
    calculateCustomerSatisfactionIndex,
    calculateNPSScore,
    calculateResponseRate
} = require("../../../services/analytics/dashboardService");

/**
 * Get executive dashboard analytics
 * @route GET /api/analytics/executive
 * @query range - Time range (7d, 30d, 90d) - default: 30d
 */
exports.getExecutiveDashboard = asyncHandler(async (req, res) => {
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

        // Dashboard data calculations
        const satisfactionData = await calculateCustomerSatisfactionIndex(tenantId, startDate);
        const npsData = await calculateNPSScore(tenantId, startDate);
        const responseRateData = await calculateResponseRate(tenantId, startDate);

        const dashboardData = {
            customerSatisfactionIndex: satisfactionData,
            npsScore: npsData,
            responseRate: responseRateData,
            generatedAt: new Date()
        };

        const duration = Date.now() - start;
        if (duration > 500) {
            Logger.warn("getExecutiveDashboard", `Slow analytics endpoint: ${duration}ms`, {
                context: { tenantId, duration, range }
            });
        }

        return res.status(200).json({
            success: true,
            message: "Executive dashboard data fetched successfully",
            data: dashboardData
        });

    } catch (error) {
        Logger.error("getExecutiveDashboard", "Error fetching executive dashboard data", {
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
            message: "Failed to fetch executive dashboard data"
        });
    }
});
