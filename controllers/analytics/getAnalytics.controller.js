// controllers/analytics/getAnalytics.controller.js
const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");
const { analyticsValidator } = require("../../validators/analyticsValidator");
const { getAnalyticsService } = require("../../services/analytics/analyticsService");

exports.getAnalytics = async (req, res, next) => {
  try {
    // Validation
    const { error } = analyticsValidator.validate(req.params);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { surveyId } = req.params;

    // Guard: Check if survey has any responses before generating analytics
    const survey = await Survey.findById(surveyId).select("totalResponses status deleted").lean();
    if (!survey || survey.deleted) {
      return res.status(404).json({ message: "Survey not found" });
    }
    if (!survey.totalResponses || survey.totalResponses === 0) {
      return res.status(400).json({
        success: false,
        message: "No responses available for analytics. Survey has 0 responses.",
        code: "NO_RESPONSES_FOR_ANALYTICS"
      });
    }

    // Service layer
    const analytics = await getAnalyticsService(surveyId);
    Logger.info("getAnalytics", "Analytics generated", {
      context: {
        surveyId
      },
      req
    });

    res.json(analytics);
  } catch (err) {
    Logger.error("generateAnalytics", "Error generating analytics", {
      error: err,
      req
    });
    next(err);
  }
};