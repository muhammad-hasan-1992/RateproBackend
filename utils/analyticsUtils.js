// utils/analyticsUtils.js
exports.calculateNPS = (responses) => {
  if (!responses.length) return { score: 0, promoters: 0, detractors: 0, passives: 0 };

  let promoters = 0, detractors = 0, passives = 0;
  let validResponses = 0;

  responses.forEach(r => {
    // Check for NPS score in 'score' field (the model uses 'score' for NPS 0-10)
    const npsValue = r.score !== undefined && r.score !== null ? Number(r.score) : null;

    if (npsValue === null || isNaN(npsValue)) return; // Skip responses without NPS score

    validResponses++;

    if (npsValue >= 9) promoters++;
    else if (npsValue <= 6) detractors++;
    else passives++;
  });

  // If no valid NPS responses, return null score to indicate N/A
  if (validResponses === 0) {
    return { score: null, promoters: 0, detractors: 0, passives: 0, totalResponses: 0 };
  }

  const nps = ((promoters - detractors) / validResponses) * 100;

  return {
    score: Number(nps.toFixed(2)),
    promoters,
    detractors,
    passives,
    totalResponses: validResponses
  };
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