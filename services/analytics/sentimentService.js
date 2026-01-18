// services/analytics/sentimentService.js
const SurveyResponse = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const aiClient = require("../../utils/aiClient");
const mongoose = require("mongoose");

/**
 * Extract JSON from AI response that may be wrapped in markdown code blocks
 */
function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  return cleaned;
}

/**
 * Analyze sentiment of a single response
 * Client Requirement 2: Response-Level Content Analysis
 */
exports.analyzeResponseSentiment = async (response) => {
  try {
    // Extract all textual content from the response
    const textContent = extractTextContent(response);

    if (!textContent || textContent.length < 5) {
      return {
        sentiment: "neutral",
        confidence: 0.5,
        emotions: [],
        keywords: [],
        themes: [],
        classification: {
          isComplaint: false,
          isPraise: false,
          isSuggestion: false
        }
      };
    }

    const aiResult = await aiClient.complete({
      prompt: `
Analyze this customer feedback comprehensively. Return JSON only (no markdown):

{
  "sentiment": "positive|neutral|negative",
  "sentimentScore": number between -1 (very negative) and 1 (very positive),
  "confidence": number between 0 and 1,
  "emotions": ["frustration", "satisfaction", "appreciation", "anger", "disappointment", "happiness"],
  "keywords": ["keyword1", "keyword2"],
  "themes": ["theme1", "theme2"],
  "classification": {
    "isComplaint": boolean,
    "isPraise": boolean,
    "isSuggestion": boolean
  },
  "summary": "brief 1-sentence summary of feedback"
}

Feedback:
"${textContent}"
      `,
      maxTokens: 400
    });

    const cleanedJSON = extractJSON(aiResult.text);
    const parsed = JSON.parse(cleanedJSON);

    return {
      sentiment: parsed.sentiment || "neutral",
      sentimentScore: parsed.sentimentScore || 0,
      confidence: parsed.confidence || 0.5,
      emotions: parsed.emotions || [],
      keywords: parsed.keywords || [],
      themes: parsed.themes || [],
      classification: {
        isComplaint: parsed.classification?.isComplaint || false,
        isPraise: parsed.classification?.isPraise || false,
        isSuggestion: parsed.classification?.isSuggestion || false
      },
      summary: parsed.summary || ""
    };

  } catch (error) {
    console.error("[SentimentService] Analysis failed:", error.message);
    return {
      sentiment: "neutral",
      confidence: 0,
      emotions: [],
      keywords: [],
      themes: [],
      classification: {
        isComplaint: false,
        isPraise: false,
        isSuggestion: false
      },
      error: error.message
    };
  }
};

/**
 * Extract text content from response answers and review
 */
function extractTextContent(response) {
  const texts = [];

  if (response.review) {
    texts.push(response.review);
  }

  if (response.answers && Array.isArray(response.answers)) {
    response.answers.forEach(answer => {
      if (typeof answer.answer === "string" && answer.answer.length > 2) {
        texts.push(answer.answer);
      }
    });
  }

  return texts.filter(Boolean).join(" ").trim();
}

/**
 * Get aggregated sentiment analysis for a survey
 * Client Requirement 4: Survey-Level Insight Aggregation
 */
exports.getSurveySentimentAnalysis = async (surveyId, options = {}) => {
  const { startDate, endDate, limit = 100 } = options;

  const query = { survey: new mongoose.Types.ObjectId(surveyId) };

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const responses = await SurveyResponse.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  if (!responses.length) {
    return {
      surveyId,
      totalResponses: 0,
      sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
      averageSentimentScore: 0,
      topKeywords: [],
      topThemes: [],
      complaintsCount: 0,
      praisesCount: 0,
      suggestionsCount: 0,
      emotionDistribution: {}
    };
  }

  // Aggregate sentiment data
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  const keywords = {};
  const themes = {};
  const emotions = {};
  let totalSentimentScore = 0;
  let complaintsCount = 0;
  let praisesCount = 0;
  let suggestionsCount = 0;

  for (const response of responses) {
    // Use stored analysis from post-response processing (no duplicate AI calls)
    const analysis = response.analysis || {
      sentiment: "neutral",
      sentimentScore: 0,
      keywords: [],
      themes: [],
      emotions: [],
      classification: {
        isComplaint: false,
        isPraise: false,
        isSuggestion: false
      }
    };

    // Count sentiments
    sentimentCounts[analysis.sentiment] = (sentimentCounts[analysis.sentiment] || 0) + 1;
    totalSentimentScore += analysis.sentimentScore || 0;

    // Aggregate keywords
    (analysis.keywords || []).forEach(kw => {
      keywords[kw] = (keywords[kw] || 0) + 1;
    });

    // Aggregate themes
    (analysis.themes || []).forEach(theme => {
      themes[theme] = (themes[theme] || 0) + 1;
    });

    // Aggregate emotions
    (analysis.emotions || []).forEach(emotion => {
      emotions[emotion] = (emotions[emotion] || 0) + 1;
    });

    // Classification counts
    if (analysis.classification?.isComplaint) complaintsCount++;
    if (analysis.classification?.isPraise) praisesCount++;
    if (analysis.classification?.isSuggestion) suggestionsCount++;
  }

  // Sort and get top items
  const topKeywords = Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  const topThemes = Object.entries(themes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, count]) => ({ theme, count }));

  return {
    surveyId,
    totalResponses: responses.length,
    sentimentDistribution: sentimentCounts,
    averageSentimentScore: Number((totalSentimentScore / responses.length).toFixed(2)),
    topKeywords,
    topThemes,
    complaintsCount,
    praisesCount,
    suggestionsCount,
    emotionDistribution: emotions,
    analyzedAt: new Date()
  };
};

/**
 * Get tenant-wide sentiment overview
 */
exports.getTenantSentimentOverview = async (tenantId, options = {}) => {
  const { days = 30 } = options;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const surveys = await Survey.find({
    tenant: tenantId,
    status: { $in: ["active", "published"] }
  }).select("_id title").lean();

  const surveyIds = surveys.map(s => s._id);

  const responses = await SurveyResponse.aggregate([
    {
      $match: {
        survey: { $in: surveyIds },
        createdAt: { $gte: startDate }
      }
    },
    {
      $lookup: {
        from: "surveys",
        localField: "survey",
        foreignField: "_id",
        as: "surveyData"
      }
    },
    {
      $group: {
        _id: null,
        totalResponses: { $sum: 1 },
        avgRating: { $avg: "$rating" },
        avgScore: { $avg: "$score" }
      }
    }
  ]);

  const stats = responses[0] || { totalResponses: 0, avgRating: 0, avgScore: 0 };

  return {
    tenantId,
    period: { days, startDate, endDate: new Date() },
    totalResponses: stats.totalResponses,
    averageRating: Number((stats.avgRating || 0).toFixed(2)),
    averageScore: Number((stats.avgScore || 0).toFixed(2)),
    surveysAnalyzed: surveys.length
  };
};

/**
 * Generate sentiment heatmap data for visualization
 */
exports.generateSentimentHeatmap = async (surveyId, options = {}) => {
  const responses = await SurveyResponse.find({
    survey: new mongoose.Types.ObjectId(surveyId)
  })
    .sort({ createdAt: 1 })
    .lean();

  const heatmapData = [];
  const survey = await Survey.findById(surveyId).lean();

  if (!survey || !responses.length) {
    return { surveyId, heatmap: [], questions: [] };
  }

  // Group responses by question
  const questionMap = {};
  survey.questions.forEach((q, idx) => {
    questionMap[q._id?.toString() || q.id] = {
      index: idx,
      text: q.questionText,
      type: q.type
    };
  });

  // Build heatmap for each response using stored analysis (no duplicate AI calls)
  for (const response of responses) {
    const responseData = {
      responseId: response._id,
      date: response.createdAt,
      // Use response-level stored analysis
      overallSentiment: response.analysis?.sentiment || "neutral",
      overallScore: response.analysis?.sentimentScore || 0,
      questions: []
    };

    // For question-level data, use the overall response sentiment
    // (Individual answer-level sentiment analysis is not stored)
    for (const answer of (response.answers || [])) {
      const qId = answer.questionId?.toString();
      const qInfo = questionMap[qId];

      if (qInfo && typeof answer.answer === "string") {
        responseData.questions.push({
          questionIndex: qInfo.index,
          questionText: qInfo.text,
          sentiment: response.analysis?.sentiment || "neutral",
          sentimentScore: response.analysis?.sentimentScore || 0
        });
      }
    }

    heatmapData.push(responseData);
  }

  return {
    surveyId,
    heatmap: heatmapData,
    questions: Object.values(questionMap).sort((a, b) => a.index - b.index)
  };
};
