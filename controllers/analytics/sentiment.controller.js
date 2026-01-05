// controllers/analytics/sentiment.controller.js
const sentimentService = require("../../services/analytics/sentimentService");
const Logger = require("../../utils/auditLog");
const asyncHandler = require("express-async-handler");

/**
 * Get sentiment analysis for a specific survey
 * Client Requirement 2 & 4: Response-level content analysis & Survey-level aggregation
 * 
 * @route   GET /api/analytics/sentiment/:surveyId
 * @access  Private
 */
exports.getSurveySentiment = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { startDate, endDate, limit = 100 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const analysis = await sentimentService.getSurveySentimentAnalysis(surveyId, {
    startDate,
    endDate,
    limit: parseInt(limit)
  });

  Logger.info("getSurveySentiment", "Survey sentiment analysis fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      totalResponses: analysis.totalResponses
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Sentiment analysis fetched successfully",
    data: analysis
  });
});

/**
 * Get tenant-wide sentiment overview
 * 
 * @route   GET /api/analytics/sentiment/overview
 * @access  Private
 */
exports.getTenantSentimentOverview = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant;
  const { days = 30 } = req.query;

  const overview = await sentimentService.getTenantSentimentOverview(tenantId, {
    days: parseInt(days)
  });

  Logger.info("getTenantSentimentOverview", "Tenant sentiment overview fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      days
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Sentiment overview fetched successfully",
    data: overview
  });
});

/**
 * Analyze sentiment for a single response (on-demand)
 * 
 * @route   POST /api/analytics/sentiment/analyze
 * @access  Private
 */
exports.analyzeResponseSentiment = asyncHandler(async (req, res) => {
  const { responseId, text, answers, review } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  let analysis;

  if (responseId) {
    // Analyze existing response by ID
    const SurveyResponse = require("../../models/SurveyResponse");
    const response = await SurveyResponse.findById(responseId).lean();
    
    if (!response) {
      return res.status(404).json({
        success: false,
        message: "Response not found"
      });
    }

    analysis = await sentimentService.analyzeResponseSentiment(response);
  } else if (text || answers || review) {
    // Analyze provided text directly
    analysis = await sentimentService.analyzeResponseSentiment({
      review: text || review,
      answers: answers || []
    });
  } else {
    return res.status(400).json({
      success: false,
      message: "Either responseId or text/answers must be provided"
    });
  }

  Logger.info("analyzeResponseSentiment", "Response sentiment analyzed", {
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
    message: "Sentiment analysis completed",
    data: analysis
  });
});

/**
 * Get sentiment heatmap for visualization
 * 
 * @route   GET /api/analytics/sentiment/:surveyId/heatmap
 * @access  Private
 */
exports.getSentimentHeatmap = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const tenantId = req.tenantId || req.user?.tenant;

  const heatmap = await sentimentService.generateSentimentHeatmap(surveyId);

  Logger.info("getSentimentHeatmap", "Sentiment heatmap generated", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      dataPoints: heatmap.heatmap?.length || 0
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Sentiment heatmap generated successfully",
    data: heatmap
  });
});

/**
 * Get complaints and praises breakdown
 * Client Requirement 4: Common complaints and praise categories
 * 
 * @route   GET /api/analytics/sentiment/:surveyId/breakdown
 * @access  Private
 */
exports.getComplaintsPraisesBreakdown = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { limit = 50 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const analysis = await sentimentService.getSurveySentimentAnalysis(surveyId, {
    limit: parseInt(limit)
  });

  const breakdown = {
    complaints: {
      count: analysis.complaintsCount,
      percentage: analysis.totalResponses > 0 
        ? Number(((analysis.complaintsCount / analysis.totalResponses) * 100).toFixed(1))
        : 0,
      topThemes: analysis.topThemes.filter(t => 
        ["issue", "problem", "complaint", "bad", "poor"].some(kw => 
          t.theme.toLowerCase().includes(kw)
        )
      )
    },
    praises: {
      count: analysis.praisesCount,
      percentage: analysis.totalResponses > 0
        ? Number(((analysis.praisesCount / analysis.totalResponses) * 100).toFixed(1))
        : 0,
      topThemes: analysis.topThemes.filter(t =>
        ["good", "great", "excellent", "amazing", "love"].some(kw =>
          t.theme.toLowerCase().includes(kw)
        )
      )
    },
    suggestions: {
      count: analysis.suggestionsCount,
      percentage: analysis.totalResponses > 0
        ? Number(((analysis.suggestionsCount / analysis.totalResponses) * 100).toFixed(1))
        : 0
    },
    topKeywords: analysis.topKeywords,
    emotionDistribution: analysis.emotionDistribution
  };

  Logger.info("getComplaintsPraisesBreakdown", "Complaints/praises breakdown fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Breakdown fetched successfully",
    data: breakdown
  });
});
