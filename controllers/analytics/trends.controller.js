// controllers/analytics/trends.controller.js
const trendService = require("../../services/analytics/trendService");
const npsService = require("../../services/analytics/npsService");
const Logger = require("../../utils/auditLog");
const asyncHandler = require("express-async-handler");

/**
 * Get satisfaction trend over time
 * Client Requirement 4: Overall satisfaction trends
 * 
 * @route   GET /api/analytics/trends/satisfaction
 * @access  Private
 */
exports.getSatisfactionTrend = asyncHandler(async (req, res) => {
  const { days = 30, interval = "day" } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const trend = await trendService.getSatisfactionTrend(tenantId, {
    days: parseInt(days),
    interval
  });

  Logger.info("getSatisfactionTrend", "Satisfaction trend fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      days,
      interval,
      dataPoints: trend.trend?.length || 0
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Satisfaction trend fetched successfully",
    data: trend
  });
});

/**
 * Get response volume trend
 * Client Requirement 4: Response volume and engagement patterns
 * 
 * @route   GET /api/analytics/trends/volume
 * @access  Private
 */
exports.getVolumeTrend = asyncHandler(async (req, res) => {
  const { days = 30, interval = "day" } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const trend = await trendService.getVolumeTrend(tenantId, {
    days: parseInt(days),
    interval
  });

  Logger.info("getVolumeTrend", "Volume trend fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      days,
      interval,
      totalResponses: trend.summary?.totalResponses || 0
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Volume trend fetched successfully",
    data: trend
  });
});

/**
 * Get survey-specific volume trend
 * 
 * @route   GET /api/analytics/trends/volume/:surveyId
 * @access  Private
 */
exports.getSurveyVolumeTrend = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { days = 30, interval = "day" } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const trend = await trendService.getSurveyVolumeTrend(surveyId, {
    days: parseInt(days),
    interval
  });

  Logger.info("getSurveyVolumeTrend", "Survey volume trend fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      days
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Survey volume trend fetched successfully",
    data: trend
  });
});

/**
 * Get NPS trend over time
 * 
 * @route   GET /api/analytics/trends/nps/:surveyId
 * @access  Private
 */
exports.getNPSTrend = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { days = 30, interval = "day" } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const trend = await npsService.getNPSTrend(surveyId, {
    days: parseInt(days),
    interval
  });

  Logger.info("getNPSTrend", "NPS trend fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      days,
      interval
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "NPS trend fetched successfully",
    data: trend
  });
});

/**
 * Get complaint/issue trend
 * Client Requirement 4: Common complaints and praise categories
 * 
 * @route   GET /api/analytics/trends/complaints
 * @access  Private
 */
exports.getComplaintTrend = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const trend = await trendService.getComplaintTrend(tenantId, {
    days: parseInt(days)
  });

  Logger.info("getComplaintTrend", "Complaint trend fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      days,
      totalIssues: trend.totalIssues
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Complaint trend fetched successfully",
    data: trend
  });
});

/**
 * Get engagement patterns
 * Client Requirement 4: Engagement patterns
 * 
 * @route   GET /api/analytics/trends/engagement
 * @access  Private
 */
exports.getEngagementPatterns = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const patterns = await trendService.getEngagementPatterns(tenantId, {
    days: parseInt(days)
  });

  Logger.info("getEngagementPatterns", "Engagement patterns fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      days,
      totalResponses: patterns.totalResponses
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Engagement patterns fetched successfully",
    data: patterns
  });
});

/**
 * Get comparative trend between two periods
 * 
 * @route   GET /api/analytics/trends/compare
 * @access  Private
 */
exports.getComparativeTrend = asyncHandler(async (req, res) => {
  const { currentDays = 30, previousDays = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const comparison = await trendService.getComparativeTrend(tenantId, {
    currentDays: parseInt(currentDays),
    previousDays: parseInt(previousDays)
  });

  Logger.info("getComparativeTrend", "Comparative trend fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      currentDays,
      previousDays
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Comparative trend fetched successfully",
    data: comparison
  });
});

/**
 * Get all trends in one call (for dashboard)
 * 
 * @route   GET /api/analytics/trends/all
 * @access  Private
 */
exports.getAllTrends = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const [satisfaction, volume, complaints, engagement, comparison] = await Promise.all([
    trendService.getSatisfactionTrend(tenantId, { days: parseInt(days) }),
    trendService.getVolumeTrend(tenantId, { days: parseInt(days) }),
    trendService.getComplaintTrend(tenantId, { days: parseInt(days) }),
    trendService.getEngagementPatterns(tenantId, { days: parseInt(days) }),
    trendService.getComparativeTrend(tenantId, { 
      currentDays: parseInt(days), 
      previousDays: parseInt(days) 
    })
  ]);

  Logger.info("getAllTrends", "All trends fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      days
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "All trends fetched successfully",
    data: {
      satisfaction,
      volume,
      complaints,
      engagement,
      comparison,
      generatedAt: new Date()
    }
  });
});
