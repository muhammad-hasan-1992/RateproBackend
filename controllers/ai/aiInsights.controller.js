// controllers/ai/aiInsights.controller.js
const aiInsightService = require("../../services/ai/aiInsightService");
const SurveyResponse = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");
const asyncHandler = require("express-async-handler");

/**
 * Analyze a survey response on-demand
 * 
 * @route   POST /api/ai/analyze
 * @access  Private
 */
exports.analyzeResponse = asyncHandler(async (req, res) => {
  const { responseId, text } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  let analysis;

  if (responseId) {
    const response = await SurveyResponse.findById(responseId)
      .populate("survey")
      .lean();

    if (!response) {
      return res.status(404).json({
        success: false,
        message: "Response not found"
      });
    }

    analysis = await aiInsightService.analyzeResponse({
      response,
      survey: response.survey
    });
  } else if (text) {
    analysis = await aiInsightService.analyzeResponse({
      response: { review: text, answers: [] },
      survey: {}
    });
  } else {
    return res.status(400).json({
      success: false,
      message: "Either responseId or text is required"
    });
  }

  Logger.info("analyzeResponse", "AI analysis completed", {
    context: {
      tenantId,
      userId: req.user?._id,
      responseId,
      sentiment: analysis.sentiment
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Analysis completed",
    data: analysis
  });
});

/**
 * Get AI insights for a survey
 * 
 * @route   GET /api/ai/insights/:surveyId
 * @access  Private
 */
exports.getSurveyInsights = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { limit = 50 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const responses = await SurveyResponse.find({ survey: surveyId })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .lean();

  const survey = await Survey.findById(surveyId).lean();

  if (!survey) {
    return res.status(404).json({
      success: false,
      message: "Survey not found"
    });
  }

  // Aggregate insights from responses with existing analysis
  const analyzedResponses = responses.filter(r => r.analysis?.sentiment);
  
  const insights = {
    surveyId,
    surveyTitle: survey.title,
    totalResponses: responses.length,
    analyzedResponses: analyzedResponses.length,
    sentimentBreakdown: {
      positive: analyzedResponses.filter(r => r.analysis.sentiment === "positive").length,
      neutral: analyzedResponses.filter(r => r.analysis.sentiment === "neutral").length,
      negative: analyzedResponses.filter(r => r.analysis.sentiment === "negative").length
    },
    urgencyBreakdown: {
      high: analyzedResponses.filter(r => r.analysis.urgency === "high").length,
      medium: analyzedResponses.filter(r => r.analysis.urgency === "medium").length,
      low: analyzedResponses.filter(r => r.analysis.urgency === "low").length
    },
    classificationsCount: {
      complaints: analyzedResponses.filter(r => r.analysis.classification?.isComplaint).length,
      praises: analyzedResponses.filter(r => r.analysis.classification?.isPraise).length,
      suggestions: analyzedResponses.filter(r => r.analysis.classification?.isSuggestion).length
    },
    topKeywords: extractTopItems(analyzedResponses, "keywords"),
    topThemes: extractTopItems(analyzedResponses, "themes"),
    topEmotions: extractTopItems(analyzedResponses, "emotions")
  };

  Logger.info("getSurveyInsights", "Survey insights fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      totalResponses: responses.length
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Survey insights fetched successfully",
    data: insights
  });
});

/**
 * Batch analyze unanalyzed responses
 * 
 * @route   POST /api/ai/batch-analyze/:surveyId
 * @access  Private (Admin)
 */
exports.batchAnalyze = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { limit = 50 } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  const survey = await Survey.findById(surveyId).lean();
  if (!survey) {
    return res.status(404).json({
      success: false,
      message: "Survey not found"
    });
  }

  // Find responses without analysis
  const unanalyzedResponses = await SurveyResponse.find({
    survey: surveyId,
    "analysis.sentiment": { $exists: false }
  })
    .limit(parseInt(limit))
    .lean();

  const results = {
    total: unanalyzedResponses.length,
    successful: 0,
    failed: 0,
    errors: []
  };

  for (const response of unanalyzedResponses) {
    try {
      const analysis = await aiInsightService.analyzeResponse({
        response,
        survey
      });

      await SurveyResponse.findByIdAndUpdate(response._id, {
        $set: {
          "analysis.sentiment": analysis.sentiment,
          "analysis.urgency": analysis.urgency,
          "analysis.analyzedAt": new Date()
        }
      });

      results.successful++;
    } catch (error) {
      results.failed++;
      results.errors.push({
        responseId: response._id,
        error: error.message
      });
    }
  }

  Logger.info("batchAnalyze", "Batch analysis completed", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      ...results
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Batch analysis completed",
    data: results
  });
});

// Helper function to extract top items from array fields
function extractTopItems(responses, field, limit = 10) {
  const counts = {};
  
  responses.forEach(r => {
    const items = r.analysis?.[field] || [];
    items.forEach(item => {
      counts[item] = (counts[item] || 0) + 1;
    });
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item, count]) => ({ item, count }));
}