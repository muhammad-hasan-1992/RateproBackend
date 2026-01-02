// services/analytics/analyticsService.js
const Feedback = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const { calculateNPS, generateSentimentHeatmap, generateTrendline } = require("../../utils/analyticsUtils");

exports.getAnalyticsService = async (surveyId) => {
  const responses = await Feedback.find({ survey: surveyId });

  const nps = calculateNPS(responses);
  const heatmap = generateSentimentHeatmap(responses);
  const trend = generateTrendline(responses);

  return {
    nps,
    sentimentHeatmap: heatmap,
    trendline: trend,
    totalResponses: responses.length
  };
};

/**
 * Update survey analytics after a new response is submitted
 * Called by postResponseProcessor after each response
 */
exports.updateSurveyAnalytics = async ({ response, survey }) => {
  try {
    const surveyId = survey._id || survey;

    // Get all responses for this survey to recalculate analytics
    const allResponses = await Feedback.find({ survey: surveyId });

    // Calculate updated metrics
    const nps = calculateNPS(allResponses);
    const totalResponses = allResponses.length;

    // Calculate average completion time if available
    let avgCompletionTime = null;
    const completionTimes = allResponses
      .filter(r => r.completionTime)
      .map(r => r.completionTime);
    
    if (completionTimes.length > 0) {
      avgCompletionTime = Math.round(
        completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      );
    }

    // Update survey with latest analytics snapshot
    await Survey.findByIdAndUpdate(surveyId, {
      $set: {
        "analytics.totalResponses": totalResponses,
        "analytics.npsScore": nps?.score || null,
        "analytics.avgCompletionTime": avgCompletionTime,
        "analytics.lastResponseAt": new Date(),
      },
      $inc: {
        "analytics.responseCount": 0 // Touch the field (actual count is set above)
      }
    });

    console.log(`📊 [analyticsService] Updated analytics for survey ${surveyId}: ${totalResponses} responses, NPS: ${nps?.score || 'N/A'}`);

    return {
      success: true,
      totalResponses,
      nps
    };
  } catch (error) {
    console.error("❌ [analyticsService] Failed to update analytics:", error.message);
    throw error;
  }
};
