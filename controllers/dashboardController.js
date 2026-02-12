// controllers/dashboardController.js
// DEPRECATED: Legacy dashboard controller — routes now redirect to /api/analytics/*
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");
const FeedbackAnalysis = require("../models/FeedbackAnalysis");
const Action = require("../models/Action");
const mongoose = require("mongoose");
const Logger = require("../utils/logger");

// Executive: high level KPIs (satisfaction index, NPS, trends)
exports.getExecutiveDashboard = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;

    let metrics = await DashboardMetrics.findOne({ tenant: tenantId });
    if (!metrics) {
      const [totalSurveys, totalResponses] = await Promise.all([
        Survey.countDocuments({ tenant: tenantId, deleted: false }),
        SurveyResponse.countDocuments({ tenant: tenantId }),
      ]);

      const responses = await SurveyResponse.find({ tenant: tenantId }).select("score rating createdAt").lean();
      const total = responses.length;
      const avgRating = total ? (responses.reduce((s, r) => s + (r.rating || 0), 0) / total) : 0;
      const avgScore = total ? (responses.reduce((s, r) => s + (r.score || 0), 0) / total) : 0;

      metrics = {
        satisfactionIndex: Math.round(avgRating * 20),
        npsTrend: [],
        topComplaints: [],
        updatedAt: new Date(),
        totalSurveys,
        totalResponses,
        averageRating: Number(avgRating.toFixed(2)),
        averageScore: Number(avgScore.toFixed(2)),
      };
    }

    // Logger.info("getExecutiveDashboard", "Fetched executive dashboard metrics", {
    //   context: {
    //     tenantId
    //   },
    //   req
    // });

    res.status(200).json({ metrics });
  } catch (err) {
    console.error('Executive dashboard error:', err);
    Logger.error("getExecutiveDashboard", "Failed to fetch executive dashboard", {
      error: err,
      context: {
        tenantId: req.tenantId
      },
      req
    });
    next(err);
  }
};

// Operational: recent alerts, SLA, open actions, top complaints
exports.getOperationalDashboard = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;

    const [
      recentNegativeFeedback,
      openActionsCount,
      slaAvgResponseTime,
      topComplaintCategories
    ] = await Promise.all([
      FeedbackAnalysis.find({ tenant: tenantId, sentiment: "negative" })
        .sort("-createdAt")
        .limit(10)
        .populate({ path: "response", populate: { path: "survey", select: "title" } }),
      Action.countDocuments({ tenant: tenantId, status: { $in: ["open", "in-progress"] } }),
      Promise.resolve(null),
      FeedbackAnalysis.aggregate([
        { $match: { tenant: new mongoose.Types.ObjectId(tenantId) } },
        { $unwind: { path: "$categories", preserveNullAndEmptyArrays: false } },
        { $group: { _id: "$categories", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ])
    ]);

    const topComplaints = topComplaintCategories.map(c => ({ category: c._id, count: c.count }));

    // Logger.info("getOperationalDashboard", "Fetched operational dashboard metrics", {
    //   context: {
    //     tenantId
    //   },
    //   req
    // });
    res.status(200).json({
      recentNegativeFeedback,
      openActionsCount,
      slaAvgResponseTime,
      topComplaints,
    });
  } catch (err) {
    console.error('Operational dashboard error:', err);
    Logger.error("getOperationalDashboard", "Failed to fetch operational dashboard", {
      error: err,
      context: {
        tenantId: req.tenantId
      },
      req
    });
    next(err);
  }
};
