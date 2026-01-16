// controllers/survey/getPublicSurveyById.controller.js
const Survey = require("../../models/Survey");
const Logger = require("../../utils/logger");

/**
 * Get a single public survey by ID for taking surveys
 * No authentication required
 */
exports.getPublicSurveyById = async (req, res, next) => {
    try {
        const survey = await Survey.findOne({
            _id: req.params.id,
            "settings.isPublic": true,
            status: "active",
            deleted: false,
        }).select("title description questions themeColor estimatedTime thankYouPage");

        if (!survey) {
            return res.status(404).json({ message: "Survey not found or not public" });
        }

        res.status(200).json({ survey });
    } catch (err) {
        Logger.error("getPublicSurveyById", "Error fetching public survey", {
            error: err,
            context: { surveyId: req.params.id },
            req,
        });
        next(err);
    }
};
