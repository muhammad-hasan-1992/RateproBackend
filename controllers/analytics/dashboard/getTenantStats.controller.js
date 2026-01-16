// controllers/analytics/dashboard/getTenantStats.controller.js
const Logger = require("../../../utils/logger");
const { getTenantStatsService } = require("../../../services/analytics/dashboardService");

/**
 * Get tenant-wide stats
 * @route GET /api/analytics/tenant
 */
exports.getTenantStats = async (req, res) => {
    try {
        const tenantId = req.user?.tenant;
        const userId = req.user?._id;

        const data = await getTenantStatsService(tenantId);

        return res.status(200).json({
            success: true,
            message: "Tenant stats fetched successfully",
            data
        });

    } catch (error) {
        Logger.error("getTenantStats", "Error fetching tenant stats", {
            error,
            context: {
                tenantId: req.user?.tenant,
                userId: req.user?._id
            },
            req
        });

        return res.status(500).json({
            success: false,
            message: "Error fetching tenant stats",
            error: error.message
        });
    }
};
