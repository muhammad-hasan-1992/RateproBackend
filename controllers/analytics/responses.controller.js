// controllers/analytics/responses.controller.js
const SurveyResponse = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const sentimentService = require("../../services/analytics/sentimentService");
const npsService = require("../../services/analytics/npsService");
const exportService = require("../../services/analytics/exportService");
const Logger = require("../../utils/auditLog");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");

/**
 * Get response analytics for a survey
 * Client Requirement 2 & 3: Response-level content analysis & Quantitative interpretation
 * 
 * @route   GET /api/analytics/responses/:surveyId
 * @access  Private
 */
exports.getSurveyResponses = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { 
    page = 1, 
    limit = 20, 
    sortBy = "createdAt",
    sortOrder = "desc",
    sentiment,
    minRating,
    maxRating,
    isAnonymous
  } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build filter query
  const query = { survey: new mongoose.Types.ObjectId(surveyId) };

  if (minRating || maxRating) {
    query.rating = {};
    if (minRating) query.rating.$gte = parseInt(minRating);
    if (maxRating) query.rating.$lte = parseInt(maxRating);
  }

  if (isAnonymous !== undefined) {
    query.isAnonymous = isAnonymous === "true";
  }

  const [responses, total] = await Promise.all([
    SurveyResponse.find(query)
      .populate("user", "name email")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    SurveyResponse.countDocuments(query)
  ]);

  // Enrich with sentiment analysis
  const enrichedResponses = await Promise.all(
    responses.map(async (response) => {
      const analysis = await sentimentService.analyzeResponseSentiment(response);
      return {
        ...response,
        analysis: {
          sentiment: analysis.sentiment,
          sentimentScore: analysis.sentimentScore,
          isComplaint: analysis.classification?.isComplaint,
          isPraise: analysis.classification?.isPraise,
          keywords: analysis.keywords?.slice(0, 5)
        }
      };
    })
  );

  // Filter by sentiment if requested (post-analysis filter)
  const filteredResponses = sentiment
    ? enrichedResponses.filter(r => r.analysis.sentiment === sentiment)
    : enrichedResponses;

  Logger.info("getSurveyResponses", "Survey responses fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      total,
      returned: filteredResponses.length
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Responses fetched successfully",
    data: {
      responses: filteredResponses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
});

/**
 * Get single response with full analysis
 * Client Requirement 2: Response-Level Content Analysis
 * 
 * @route   GET /api/analytics/responses/detail/:responseId
 * @access  Private
 */
exports.getResponseDetail = asyncHandler(async (req, res) => {
  const { responseId } = req.params;
  const tenantId = req.tenantId || req.user?.tenant;

  const response = await SurveyResponse.findById(responseId)
    .populate("user", "name email")
    .populate("survey", "title questions")
    .lean();

  if (!response) {
    return res.status(404).json({
      success: false,
      message: "Response not found"
    });
  }

  // Full sentiment analysis
  const analysis = await sentimentService.analyzeResponseSentiment(response);

  // NPS classification
  const npsCategory = response.score !== undefined 
    ? (response.score >= 9 ? "promoter" : response.score <= 6 ? "detractor" : "passive")
    : null;

  // Rating category
  const ratingCategory = response.rating 
    ? npsService.categorizeRating(response.rating)
    : null;

  const detail = {
    response: {
      id: response._id,
      submittedAt: response.createdAt,
      isAnonymous: response.isAnonymous,
      respondent: response.isAnonymous ? null : {
        name: response.user?.name,
        email: response.user?.email
      }
    },
    survey: {
      id: response.survey?._id,
      title: response.survey?.title
    },
    metrics: {
      rating: response.rating,
      ratingCategory,
      npsScore: response.score,
      npsCategory
    },
    answers: response.answers?.map(answer => {
      const question = response.survey?.questions?.find(
        q => q._id?.toString() === answer.questionId?.toString() || q.id === answer.questionId
      );
      return {
        questionId: answer.questionId,
        questionText: question?.questionText || "Unknown question",
        questionType: question?.type,
        answer: answer.answer
      };
    }),
    review: response.review,
    analysis: {
      sentiment: analysis.sentiment,
      sentimentScore: analysis.sentimentScore,
      confidence: analysis.confidence,
      emotions: analysis.emotions,
      keywords: analysis.keywords,
      themes: analysis.themes,
      classification: analysis.classification,
      summary: analysis.summary
    }
  };

  Logger.info("getResponseDetail", "Response detail fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      responseId
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Response detail fetched successfully",
    data: detail
  });
});

/**
 * Get anonymous vs identified response breakdown
 * Client Requirement 6: Anonymous vs Invited Response Handling
 * 
 * @route   GET /api/analytics/responses/:surveyId/breakdown
 * @access  Private
 */
exports.getResponseBreakdown = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const tenantId = req.tenantId || req.user?.tenant;

  const [anonymous, identified, total] = await Promise.all([
    SurveyResponse.countDocuments({ 
      survey: new mongoose.Types.ObjectId(surveyId), 
      isAnonymous: true 
    }),
    SurveyResponse.countDocuments({ 
      survey: new mongoose.Types.ObjectId(surveyId), 
      isAnonymous: false 
    }),
    SurveyResponse.countDocuments({ 
      survey: new mongoose.Types.ObjectId(surveyId) 
    })
  ]);

  // Get sentiment breakdown for each type
  const [anonymousResponses, identifiedResponses] = await Promise.all([
    SurveyResponse.find({ 
      survey: new mongoose.Types.ObjectId(surveyId), 
      isAnonymous: true 
    }).limit(50).lean(),
    SurveyResponse.find({ 
      survey: new mongoose.Types.ObjectId(surveyId), 
      isAnonymous: false 
    }).limit(50).lean()
  ]);

  // Calculate metrics for each group
  const anonymousNPS = npsService.calculateNPS(anonymousResponses);
  const identifiedNPS = npsService.calculateNPS(identifiedResponses);
  const anonymousCSI = npsService.calculateCSI(anonymousResponses);
  const identifiedCSI = npsService.calculateCSI(identifiedResponses);

  const breakdown = {
    total,
    anonymous: {
      count: anonymous,
      percentage: total > 0 ? Number(((anonymous / total) * 100).toFixed(1)) : 0,
      nps: anonymousNPS.score,
      avgRating: anonymousCSI.averageRating
    },
    identified: {
      count: identified,
      percentage: total > 0 ? Number(((identified / total) * 100).toFixed(1)) : 0,
      nps: identifiedNPS.score,
      avgRating: identifiedCSI.averageRating
    },
    insight: anonymous > identified 
      ? "Most responses are anonymous - consider incentives for identified feedback"
      : "Good mix of identified respondents for CRM enrichment"
  };

  Logger.info("getResponseBreakdown", "Response breakdown fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      total
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Response breakdown fetched successfully",
    data: breakdown
  });
});

/**
 * Export responses to CSV
 * 
 * @route   GET /api/analytics/responses/:surveyId/export/csv
 * @access  Private
 */
exports.exportResponsesCSV = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { startDate, endDate, includeAnalysis = false } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const result = await exportService.exportResponsesCSV(surveyId, {
    startDate,
    endDate,
    includeAnalysis: includeAnalysis === "true"
  });

  Logger.info("exportResponsesCSV", "Responses exported to CSV", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId,
      recordCount: result.recordCount
    },
    req
  });

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  res.send(result.content);
});

/**
 * Export analytics to PDF
 * 
 * @route   GET /api/analytics/responses/:surveyId/export/pdf
 * @access  Private
 */
exports.exportAnalyticsPDF = asyncHandler(async (req, res) => {
  const { surveyId } = req.params;
  const { days = 30 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  const result = await exportService.exportAnalyticsPDF(surveyId, {
    days: parseInt(days)
  });

  Logger.info("exportAnalyticsPDF", "Analytics exported to PDF", {
    context: {
      tenantId,
      userId: req.user?._id,
      surveyId
    },
    req
  });

  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  res.send(result.content);
});

/**
 * Get responses flagged for action
 * Client Requirement 5: Feedback requiring action
 * 
 * @route   GET /api/analytics/responses/flagged
 * @access  Private
 */
exports.getFlaggedResponses = asyncHandler(async (req, res) => {
  const { limit = 20 } = req.query;
  const tenantId = req.tenantId || req.user?.tenant;

  // Get all tenant surveys
  const surveys = await Survey.find({ tenant: tenantId }).select("_id title").lean();
  const surveyIds = surveys.map(s => s._id);
  const surveyMap = Object.fromEntries(surveys.map(s => [s._id.toString(), s.title]));

  // Find responses with low ratings or scores
  const flaggedResponses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    $or: [
      { rating: { $lte: 2 } },
      { score: { $lte: 6 } }
    ]
  })
    .populate("user", "name email")
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .lean();

  // Enrich with analysis
  const enriched = await Promise.all(
    flaggedResponses.map(async (response) => {
      const analysis = await sentimentService.analyzeResponseSentiment(response);
      return {
        responseId: response._id,
        surveyId: response.survey,
        surveyTitle: surveyMap[response.survey?.toString()],
        submittedAt: response.createdAt,
        isAnonymous: response.isAnonymous,
        respondent: response.isAnonymous ? null : response.user?.email,
        rating: response.rating,
        npsScore: response.score,
        review: response.review?.substring(0, 200),
        flagReason: response.rating <= 2 ? "Low Rating" : "Low NPS",
        sentiment: analysis.sentiment,
        isComplaint: analysis.classification?.isComplaint,
        summary: analysis.summary
      };
    })
  );

  Logger.info("getFlaggedResponses", "Flagged responses fetched", {
    context: {
      tenantId,
      userId: req.user?._id,
      count: enriched.length
    },
    req
  });

  res.status(200).json({
    success: true,
    message: "Flagged responses fetched successfully",
    data: {
      responses: enriched,
      total: enriched.length
    }
  });
});
