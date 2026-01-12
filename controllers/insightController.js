// controllers/insightController.js
const { calculateNPS, generateSentimentHeatmap, generateTrendline } = require("../utils/insightUtils");
const Logger = require("../utils/logger");

const getPredictiveInsights = async (req, res) => {
  const { surveyId } = req.params;
  try {
    const nps = await calculateNPS(surveyId);
    const sentimentHeatmap = await generateSentimentHeatmap(surveyId);
    const trendline = await generateTrendline(surveyId);

    // Logger.info("getPredictiveInsights", "Insights generated successfully", {
    //   context: {
    //     surveyId,
    //     npsScore: nps?.score,
    //     sentimentCount: sentimentHeatmap?.length || 0
    //   },
    //   req
    // });

    res.json({ nps, sentimentHeatmap, trendline });
  } catch (err) {
    Logger.error("getPredictiveInsights", "Error generating insights", {
      error: err,
      context: {
        surveyId
      },
      req
    });
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getPredictiveInsights };