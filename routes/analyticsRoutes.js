// routes/analyticsRoutes.js
// ============================================================================
// Analytics Routes - TENANT LAYER (Company Admin + Member)
// 
// These routes are for tenant-scoped analytics resources.
// System Admin (role: 'admin') MUST NOT access these routes.
// ============================================================================

const express = require("express");
const router = express.Router();

// Dashboard controller imports (refactored)
const { getSurveyStats } = require("../controllers/analytics/dashboard/getSurveyStats.controller");
const { getTenantStats } = require("../controllers/analytics/dashboard/getTenantStats.controller");
const { getExecutiveDashboard } = require("../controllers/analytics/dashboard/executiveDashboard.controller");
const { getOperationalDashboard } = require("../controllers/analytics/dashboard/operationalDashboard.controller");
const { getTrendsAnalytics } = require("../controllers/analytics/dashboard/trendsDashboard.controller");
const { getAlerts } = require("../controllers/analytics/dashboard/alerts.controller");

// New modular controller imports
const sentimentController = require("../controllers/analytics/sentiment.controller");
const summaryController = require("../controllers/analytics/summary.controller");
const trendsController = require("../controllers/analytics/trends.controller");
const responsesController = require("../controllers/analytics/responses.controller");
const { getAnalytics } = require("../controllers/analytics/getAnalytics.controller");

const { protect } = require("../middlewares/authMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");
const { enforceTenantScope } = require("../middlewares/scopeMiddleware");


// ============================================================================
// 🔒 Apply authentication and scope enforcement to all routes
// ============================================================================
// Middleware chain: protect → setTenantId → enforceTenantScope
// This explicitly BLOCKS System Admin from accessing tenant analytics
router.use(protect);
router.use(setTenantId);
router.use(enforceTenantScope);  // Blocks System Admin from tenant resources

// ===== LEGACY ROUTES (for backward compatibility) =====
router.get("/survey/:surveyId", getSurveyStats);
router.get("/tenant", getTenantStats);

// ===== ENHANCED DASHBOARD ANALYTICS ROUTES (Flow.md Section 8) =====

/**
 * @route   GET /api/analytics/executive
 * @desc    Get executive dashboard analytics (CSI, NPS, Response Rate)
 * @access  Private (Admin/Manager)
 * @params  ?range=7d|30d|90d (default: 30d)
 */
router.get("/executive", getExecutiveDashboard);

/**
 * @route   GET /api/analytics/operational
 * @desc    Get operational dashboard analytics (Alerts, SLA, Top Issues)
 * @access  Private (Admin/Manager/Operator)
 * @params  ?range=7d|30d|90d (default: 30d)
 */
router.get("/operational", getOperationalDashboard);

/**
 * @route   GET /api/analytics/trends
 * @desc    Get trend analytics (Satisfaction trends, Volume trends)
 * @access  Private (Admin/Manager)
 * @params  ?range=7d|30d|90d (default: 30d)
 */
router.get("/trends", getTrendsAnalytics);

/**
 * @route   GET /api/analytics/alerts
 * @desc    Get real-time smart alerts
 * @access  Private (All authenticated users)
 */
router.get("/alerts", getAlerts);

// ===== DEMOGRAPHICS ROUTES =====
const demographicsController = require("../controllers/analytics/demographics.controller");

/**
 * @route   GET /api/analytics/demographics
 * @desc    Get response demographics breakdown (device, browser, OS, location, time patterns)
 * @access  Private
 * @params  ?days=30&surveyId=<optional>
 */
router.get("/demographics", demographicsController.getDemographics);

/**
 * @route   GET /api/analytics/demographics/:surveyId
 * @desc    Get survey-specific demographics
 * @access  Private
 */
router.get("/demographics/:surveyId", demographicsController.getSurveyDemographics);

// ===== SENTIMENT ANALYSIS ROUTES =====
// Client Requirement 2: Response-Level Content Analysis

/**
 * @route   GET /api/analytics/sentiment/overview
 * @desc    Get tenant-wide sentiment overview
 * @access  Private
 * @params  ?days=30
 */
router.get("/sentiment/overview", sentimentController.getTenantSentimentOverview);

/**
 * @route   POST /api/analytics/sentiment/analyze
 * @desc    Analyze sentiment for a response or text (on-demand)
 * @access  Private
 * @body    { responseId } or { text, answers, review }
 */
router.post("/sentiment/analyze", sentimentController.analyzeResponseSentiment);

/**
 * @route   GET /api/analytics/sentiment/:surveyId
 * @desc    Get sentiment analysis for a specific survey
 * @access  Private
 * @params  ?startDate, ?endDate, ?limit
 */
router.get("/sentiment/:surveyId", sentimentController.getSurveySentiment);

/**
 * @route   GET /api/analytics/sentiment/:surveyId/heatmap
 * @desc    Get sentiment heatmap for visualization
 * @access  Private
 */
router.get("/sentiment/:surveyId/heatmap", sentimentController.getSentimentHeatmap);

/**
 * @route   GET /api/analytics/sentiment/:surveyId/breakdown
 * @desc    Get complaints/praises breakdown
 * @access  Private
 */
router.get("/sentiment/:surveyId/breakdown", sentimentController.getComplaintsPraisesBreakdown);

// ===== SUMMARY & INSIGHTS ROUTES =====
// Client Requirement 4: Survey-Level Insight Aggregation

/**
 * @route   GET /api/analytics/summary/tenant
 * @desc    Get tenant-wide insights dashboard
 * @access  Private
 * @params  ?days=30
 */
router.get("/summary/tenant", summaryController.getTenantSummary);

/**
 * @route   GET /api/analytics/summary/quick
 * @desc    Get quick insights for dashboard widgets
 * @access  Private
 * @params  ?hours=24
 */
router.get("/summary/quick", summaryController.getQuickInsights);

/**
 * @route   POST /api/analytics/summary/compare
 * @desc    Compare multiple surveys
 * @access  Private
 * @body    { surveyIds: [] }
 */
router.post("/summary/compare", summaryController.compareSurveys);

/**
 * @route   GET /api/analytics/summary/:surveyId
 * @desc    Get comprehensive survey summary/insights
 * @access  Private
 * @params  ?days=30
 */
router.get("/summary/:surveyId", summaryController.getSurveySummary);

// ===== TRENDS ROUTES =====
// Client Requirement 4: Response volume and engagement patterns

/**
 * @route   GET /api/analytics/trends/all
 * @desc    Get all trends in one call (for dashboard)
 * @access  Private
 * @params  ?days=30
 */
router.get("/trends/all", trendsController.getAllTrends);

/**
 * @route   GET /api/analytics/trends/satisfaction
 * @desc    Get satisfaction trend over time
 * @access  Private
 * @params  ?days=30, ?interval=day|week|month
 */
router.get("/trends/satisfaction", trendsController.getSatisfactionTrend);

/**
 * @route   GET /api/analytics/trends/volume
 * @desc    Get response volume trend
 * @access  Private
 * @params  ?days=30, ?interval=day|week|month
 */
router.get("/trends/volume", trendsController.getVolumeTrend);

/**
 * @route   GET /api/analytics/trends/volume/:surveyId
 * @desc    Get survey-specific volume trend
 * @access  Private
 * @params  ?days=30, ?interval=day|week|month
 */
router.get("/trends/volume/:surveyId", trendsController.getSurveyVolumeTrend);

/**
 * @route   GET /api/analytics/trends/nps/:surveyId
 * @desc    Get NPS trend over time
 * @access  Private
 * @params  ?days=30, ?interval=day|week|month
 */
router.get("/trends/nps/:surveyId", trendsController.getNPSTrend);

/**
 * @route   GET /api/analytics/trends/complaints
 * @desc    Get complaint/issue trend
 * @access  Private
 * @params  ?days=30
 */
router.get("/trends/complaints", trendsController.getComplaintTrend);

/**
 * @route   GET /api/analytics/trends/engagement
 * @desc    Get engagement patterns (peak hours, days)
 * @access  Private
 * @params  ?days=30
 */
router.get("/trends/engagement", trendsController.getEngagementPatterns);

/**
 * @route   GET /api/analytics/trends/compare
 * @desc    Get comparative trend between two periods
 * @access  Private
 * @params  ?currentDays=30, ?previousDays=30
 */
router.get("/trends/compare", trendsController.getComparativeTrend);

// ===== RESPONSE ANALYTICS ROUTES =====
// Client Requirement 2, 3, 6: Response-level analysis

/**
 * @route   GET /api/analytics/responses/flagged
 * @desc    Get responses flagged for action (low ratings, detractors)
 * @access  Private
 * @params  ?limit=20
 */
router.get("/responses/flagged", responsesController.getFlaggedResponses);

/**
 * @route   GET /api/analytics/responses/detail/:responseId
 * @desc    Get single response with full analysis
 * @access  Private
 */
router.get("/responses/detail/:responseId", responsesController.getResponseDetail);

/**
 * @route   GET /api/analytics/responses/:surveyId
 * @desc    Get response analytics for a survey with filtering
 * @access  Private
 * @params  ?page, ?limit, ?sortBy, ?sentiment, ?minRating, ?maxRating, ?isAnonymous
 */
router.get("/responses/:surveyId", responsesController.getSurveyResponses);

/**
 * @route   GET /api/analytics/responses/:surveyId/breakdown
 * @desc    Get anonymous vs identified response breakdown
 * @access  Private
 */
router.get("/responses/:surveyId/breakdown", responsesController.getResponseBreakdown);

/**
 * @route   GET /api/analytics/responses/:surveyId/export/csv
 * @desc    Export responses to CSV
 * @access  Private
 * @params  ?startDate, ?endDate, ?includeAnalysis
 */
router.get("/responses/:surveyId/export/csv", responsesController.exportResponsesCSV);

/**
 * @route   GET /api/analytics/responses/:surveyId/export/pdf
 * @desc    Export analytics to PDF
 * @access  Private
 * @params  ?days=30
 */
router.get("/responses/:surveyId/export/pdf", responsesController.exportAnalyticsPDF);

// ===== SURVEY-SPECIFIC ANALYTICS =====

/**
 * @route   GET /api/analytics/:surveyId
 * @desc    Get analytics for a specific survey (NPS, heatmap, trendline)
 * @access  Private
 */
router.get("/:surveyId", getAnalytics);

module.exports = router;