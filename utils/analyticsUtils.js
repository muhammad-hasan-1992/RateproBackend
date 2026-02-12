// NPS calculation consolidated into npsService.calculateNPS()
// This wrapper exists for backward compatibility only.
exports.calculateNPS = (...args) => {
  const npsService = require('../services/analytics/npsService');
  return npsService.calculateNPS(...args);
};

exports.generateSentimentHeatmap = (responses) => {
  // Read from stored analysis field (populated by post-response processor)
  return responses.map(r => ({
    questionId: r.questionId,
    sentiment: r.analysis?.sentiment || "neutral",
    score: r.analysis?.sentimentScore || 0
  }));
};

exports.generateTrendline = (responses) => {
  const data = {};

  responses.forEach(r => {
    const date = r.createdAt.toISOString().split("T")[0];
    if (!data[date]) data[date] = 0;
    data[date]++;
  });

  return Object.entries(data).map(([date, count]) => ({ date, count }));
};