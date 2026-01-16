// controllers/analytics/dashboard/getSurveyStats.controller.js
const Logger = require("../../../utils/logger");
const { getSurveyStatsService } = require("../../../services/analytics/dashboardService");

/**
 * Get stats for a specific survey
 * @route GET /api/analytics/survey/:surveyId
 */
exports.getSurveyStats = async (req, res) => {
    try {
        const { surveyId } = req.params;
        const tenant = req.user?.tenant;

        const data = await getSurveyStatsService(surveyId);

        return res.status(200).json({
            success: true,
            message: "Survey stats fetched successfully",
            data
        });

    } catch (error) {
        Logger.error("getSurveyStats", "Error fetching survey stats", {
            error,
            context: {
                tenantId: req.user?.tenant,
                userId: req.user?._id
            },
            req
        });

        return res.status(500).json({
            success: false,
            message: "Error fetching survey stats",
            error: error.message
        });
    }
};
