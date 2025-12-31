// services/analytics/analyticsService.js
const Feedback = require("../../models/SurveyResponse");
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
