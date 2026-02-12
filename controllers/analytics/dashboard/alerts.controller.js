// controllers/analytics/dashboard/alerts.controller.js
const asyncHandler = require("express-async-handler");
const Action = require("../../../models/Action");
const SurveyResponse = require("../../../models/SurveyResponse");
const Logger = require("../../../utils/logger");
const { generateSmartAlerts } = require("../../../services/analytics/dashboardService");

/**
 * Get smart alerts
 * @route GET /api/analytics/alerts
 */
exports.getAlerts = asyncHandler(async (req, res) => {
    const start = Date.now();
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(403).json({
                success: false,
                message: "Tenant context required"
            });
        }
        const userId = req.user?._id;

        const recentActions = await Action.find({
            tenant: tenantId,
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
            .sort({ createdAt: -1 })
            .limit(10);

        // FIXED: Added tenant filtering to prevent cross-tenant data exposure
        const recentResponses = await SurveyResponse.find({
            tenant: tenantId,
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
            .populate("survey")
            .sort({ createdAt: -1 })
            .limit(50);

        const alerts = await generateSmartAlerts(recentActions, recentResponses, tenantId);

        const duration = Date.now() - start;
        if (duration > 500) {
            Logger.warn("getAlerts", `Slow analytics endpoint: ${duration}ms`, { context: { tenantId, duration } });
        }

        return res.status(200).json({
            success: true,
            message: "Alerts fetched successfully",
            data: { alerts }
        });

    } catch (error) {
        Logger.error("getAlerts", "Error fetching alerts", {
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
            message: "Failed to fetch alerts"
        });
    }
});
