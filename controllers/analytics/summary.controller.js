// controllers/analytics/summary.controller.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const Action = require("../../models/Action");
const npsService = require("../../services/analytics/npsService");
const sentimentService = require("../../services/analytics/sentimentService");
const trendService = require("../../services/analytics/trendService");
const Logger = require("../../utils/auditLog");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

/**
 * Get comprehensive survey summary/insights
 * Client Requirement 4: Survey-Level Insight Aggregation
 * 
 * @route   GET /api/analytics/summary/:surveyId
 * @access  Private
 */
exports.getSurveySummary = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { days = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  // Fetch survey details
  const survey = await Survey.findById(surveyId)
    .select("title description status totalResponses createdAt")
    .lean();

  if (!survey) {
    return res.status(404).json({
      success: false,
      message: "Survey not found"
    });
  }

  // Gather all analytics in parallel
  const [nps, csi, sentiment, volumeTrend, responses] = await Promise.all([
    npsService.getSurveyNPS(surveyId, { startDate }),
    npsService.getSurveyCSI(surveyId, { startDate }),
    sentimentService.getSurveySentimentAnalysis(surveyId, { limit: 100 }),
    trendService.getSurveyVolumeTrend(surveyId, { days: parseInt(days) }),
    SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(surveyId),
      createdAt: { $gte: startDate }
    })
  ]);

  // Count actions generated from this survey
  const actionsCount = await Action.countDocuments({
    "metadata.surveyId": new mongoose.Types.ObjectId(surveyId),
    createdAt: { $gte: startDate }
  });

  const summary = {
    survey: {
      id: survey._id,
      title: survey.title,
      description: survey.description,
      status: survey.status,
      createdAt: survey.createdAt
    },
    period: {
      days: parseInt(days),
      startDate,
      endDate: new Date()
    },
    metrics: {
      totalResponses: responses,
      allTimeResponses: survey.totalResponses || 0,
      nps: {
        score: nps.score,
        promoters: nps.promoters,
        detractors: nps.detractors,
        passives: nps.passives,
        distribution: nps.distribution
      },
      csi: {
        score: csi.score,
        averageRating: csi.averageRating
      },
      sentiment: {
        distribution: sentiment.sentimentDistribution,
        averageScore: sentiment.averageSentimentScore,
        complaintsCount: sentiment.complaintsCount,
        praisesCount: sentiment.praisesCount,
        suggestionsCount: sentiment.suggestionsCount
      },
      actionsGenerated: actionsCount
    },
    insights: {
      topKeywords: sentiment.topKeywords.slice(0, 5),
      topThemes: sentiment.topThemes.slice(0, 5),
      emotionDistribution: sentiment.emotionDistribution,
      volumeTrend: volumeTrend.trend.slice(-7) // Last 7 data points
    },
    generatedAt: new Date()
  };

  Logger.info("getSurveySummary", "Survey summary fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      totalResponses: responses
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Survey summary fetched successfully",
    data: summary
  });
});

/**
 * Get tenant-wide insights dashboard
 * Client Requirement 8: Executive & Operational Visibility
 * 
 * @route   GET /api/analytics/summary/tenant
 * @access  Private
 */
exports.getTenantSummary = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  // Get all tenant surveys
  const surveys = await Survey.find({ tenant: tenantId })
    .select("_id title status totalResponses")
    .lean();

  const surveyIds = surveys.map(s => s._id);

  // Gather analytics in parallel
  const [nps, csi, sentiment, volumeTrend, engagement, actions] = await Promise.all([
    npsService.getTenantNPS(tenantId, { days: parseInt(days) }),
    npsService.getTenantCSI(tenantId, { days: parseInt(days) }),
    sentimentService.getTenantSentimentOverview(tenantId, { days: parseInt(days) }),
    trendService.getVolumeTrend(tenantId, { days: parseInt(days) }),
    trendService.getEngagementPatterns(tenantId, { days: parseInt(days) }),
    Action.countDocuments({
      tenant: tenantId,
      createdAt: { $gte: startDate }
    })
  ]);

  // Calculate active vs inactive surveys
  const activeSurveys = surveys.filter(s =>
    ["active", "published"].includes(s.status)
  ).length;

  // Get comparative data (current vs previous period)
  const comparison = await trendService.getComparativeTrend(tenantId, {
    currentDays: parseInt(days),
    previousDays: parseInt(days)
  });

  const summary = {
    tenant: tenantId,
    period: {
      days: parseInt(days),
      startDate,
      endDate: new Date()
    },
    overview: {
      totalSurveys: surveys.length,
      activeSurveys,
      totalResponses: volumeTrend.summary.totalResponses,
      actionsGenerated: actions
    },
    kpis: {
      nps: {
        current: nps.score,
        trend: comparison.changes.avgScore > 0 ? "up" : comparison.changes.avgScore < 0 ? "down" : "stable",
        change: comparison.changes.avgScore,
        promoters: nps.promoters || 0,
        passives: nps.passives || 0,
        detractors: nps.detractors || 0
      },
      csi: {
        current: csi.score,
        averageRating: csi.averageRating
      },
      responseRate: {
        current: sentiment.totalResponses,
        avgPerSurvey: surveys.length > 0
          ? Math.round(sentiment.totalResponses / surveys.length)
          : 0
      }
    },
    sentiment: {
      avgRating: sentiment.averageRating,
      avgScore: sentiment.averageScore
    },
    trends: {
      volume: volumeTrend.trend.slice(-7),
      growth: volumeTrend.summary.growthRate,
      peakDate: volumeTrend.summary.peakDate
    },
    engagement: {
      peakHour: engagement.peakEngagement?.hourFormatted,
      peakDay: engagement.peakEngagement?.day,
      avgCompletionTime: engagement.avgCompletionTime
    },
    comparison: {
      responseChange: comparison.changes.responseCount,
      ratingChange: comparison.changes.avgRating,
      direction: comparison.changes.responseCount > 0 ? "improving" : "declining"
    },
    generatedAt: new Date()
  };

  Logger.info("getTenantSummary", "Tenant summary fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyCount: surveys.length,
      responseCount: volumeTrend.summary.totalResponses
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Tenant summary fetched successfully",
    data: summary
  });
});

/**
 * Get quick insights for dashboard widgets
 * Client Requirement 4: Near real-time dashboard consumption
 * 
 * @route   GET /api/analytics/summary/quick
 * @access  Private
 */
exports.getQuickInsights = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant;
  const { hours = 24 } = req.query;

  const startDate = new Date();
  startDate.setHours(startDate.getHours() - parseInt(hours));

  // Get all tenant surveys
  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  // Get recent responses
  const recentResponses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    createdAt: { $gte: startDate }
  })
    .select("rating score createdAt")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  // Quick calculations
  const nps = npsService.calculateNPS(recentResponses);
  const csi = npsService.calculateCSI(recentResponses);

  // Get recent actions
  const recentActions = await Action.countDocuments({
    tenant: tenantId,
    createdAt: { $gte: startDate }
  });

  const pendingActions = await Action.countDocuments({
    tenant: tenantId,
    status: { $in: ["pending", "open"] }
  });

  const insights = {
    period: {
      hours: parseInt(hours),
      since: startDate
    },
    quickStats: {
      newResponses: recentResponses.length,
      npsScore: nps.score,
      csiScore: csi.score,
      avgRating: csi.averageRating,
      newActions: recentActions,
      pendingActions
    },
    alerts: {
      lowSatisfaction: recentResponses.filter(r => r.rating && r.rating <= 2).length,
      lowNPS: recentResponses.filter(r => r.score && r.score <= 6).length
    },
    generatedAt: new Date()
  };

  Logger.info("getQuickInsights", "Quick insights fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      hours,
      responseCount: recentResponses.length
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Quick insights fetched successfully",
    data: insights
  });
});

/**
 * Get survey comparison
 * 
 * @route   POST /api/analytics/summary/compare
 * @access  Private
 */
exports.compareSurveys = asyncHandler(async (req, res) => {
  const { surveyIds } = req.body;
  const tenantId = req.tenantId || req.user?.tenant;

  if (!surveyIds || !Array.isArray(surveyIds) || surveyIds.length < 2) {
    return res.status(400).json({
      success: false,
      message: "At least 2 survey IDs are required for comparison"
    });
  }

  const comparison = await npsService.compareSurveyNPS(surveyIds);

  // Enrich with additional metrics
  const enrichedComparisons = await Promise.all(
    comparison.comparisons.map(async (c) => {
      const csi = await npsService.getSurveyCSI(c.surveyId);
      return {
        ...c,
        csi: csi.score,
        avgRating: csi.averageRating
      };
    })
  );

  Logger.info("compareSurveys", "Survey comparison completed", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveysCompared: surveyIds.length
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Survey comparison completed",
    data: {
      comparisons: enrichedComparisons,
      bestPerforming: comparison.bestPerforming,
      worstPerforming: comparison.worstPerforming,
      averageNPS: comparison.averageNPS
    }
  });
});
