// services/analytics/trendService.js
const SurveyResponse = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const Action = require("../../models/Action");
const mongoose = require("mongoose");

/**
 * Get satisfaction trend over time
 * Client Requirement 4: Overall satisfaction trends
 */
exports.getSatisfactionTrend = async (tenantId, options = {}) => {
  const { days = 30, interval = "day" } = options;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get all tenant surveys
  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  const responses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    createdAt: { $gte: startDate }
  })
    .select("rating score createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const trendData = groupByInterval(responses, interval);

  return {
    tenantId,
    period: { days, interval, startDate, endDate: new Date() },
    trend: trendData.map(({ date, items }) => ({
      date,
      avgRating: calculateAverage(items, "rating"),
      avgScore: calculateAverage(items, "score"),
      responseCount: items.length
    })),
    summary: {
      totalResponses: responses.length,
      overallAvgRating: calculateAverage(responses, "rating"),
      overallAvgScore: calculateAverage(responses, "score")
    }
  };
};

/**
 * Get response volume trend
 * Client Requirement 4: Response volume and engagement patterns
 */
exports.getVolumeTrend = async (tenantId, options = {}) => {
  const { days = 30, interval = "day" } = options;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  // Get response counts grouped by interval
  const responses = await SurveyResponse.aggregate([
    {
      $match: {
        survey: { $in: surveyIds },
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: getIntervalGrouping(interval),
        count: { $sum: 1 },
        avgRating: { $avg: "$rating" },
        avgScore: { $avg: "$score" }
      }
    },
    { $sort: { "_id": 1 } }
  ]);

  // Fill gaps with zeros
  const filledTrend = fillDateGaps(responses, startDate, new Date(), interval);

  // Calculate week-over-week or day-over-day change
  const trend = filledTrend.map((item, idx) => ({
    date: item.date,
    count: item.count,
    avgRating: Number((item.avgRating || 0).toFixed(2)),
    change: idx > 0 
      ? Number(((item.count - filledTrend[idx - 1].count) / (filledTrend[idx - 1].count || 1) * 100).toFixed(1))
      : 0
  }));

  return {
    tenantId,
    period: { days, interval, startDate, endDate: new Date() },
    trend,
    summary: {
      totalResponses: trend.reduce((sum, t) => sum + t.count, 0),
      averagePerInterval: Number((trend.reduce((sum, t) => sum + t.count, 0) / trend.length || 0).toFixed(1)),
      peakDate: trend.reduce((max, t) => t.count > (max?.count || 0) ? t : max, null)?.date,
      growthRate: calculateGrowthRate(trend)
    }
  };
};

/**
 * Get survey-specific volume trend
 */
exports.getSurveyVolumeTrend = async (surveyId, options = {}) => {
  const { days = 30, interval = "day" } = options;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const responses = await SurveyResponse.find({
    survey: new mongoose.Types.ObjectId(surveyId),
    createdAt: { $gte: startDate }
  })
    .select("createdAt rating score")
    .sort({ createdAt: 1 })
    .lean();

  const trendData = groupByInterval(responses, interval);

  return {
    surveyId,
    period: { days, interval, startDate, endDate: new Date() },
    trend: trendData.map(({ date, items }) => ({
      date,
      count: items.length,
      avgRating: calculateAverage(items, "rating")
    })),
    totalResponses: responses.length
  };
};

/**
 * Get complaint/praise trend
 * Client Requirement 4: Common complaints and praise categories
 */
exports.getComplaintTrend = async (tenantId, options = {}) => {
  const { days = 30 } = options;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get actions generated from feedback
  const actions = await Action.find({
    tenant: tenantId,
    source: { $in: ["survey_feedback", "ai_generated"] },
    createdAt: { $gte: startDate }
  })
    .select("category tags priority metadata createdAt")
    .lean();

  // Group by category
  const categoryStats = {};
  actions.forEach(action => {
    const cat = action.category || "uncategorized";
    if (!categoryStats[cat]) {
      categoryStats[cat] = { count: 0, highPriority: 0, resolved: 0 };
    }
    categoryStats[cat].count++;
    if (action.priority === "high") categoryStats[cat].highPriority++;
  });

  // Sort by count
  const sortedCategories = Object.entries(categoryStats)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([category, stats]) => ({
      category,
      ...stats,
      percentage: Number(((stats.count / actions.length) * 100).toFixed(1))
    }));

  return {
    tenantId,
    period: { days, startDate, endDate: new Date() },
    categories: sortedCategories,
    totalIssues: actions.length,
    topCategory: sortedCategories[0] || null
  };
};

/**
 * Get engagement pattern analysis
 * Client Requirement 4: Engagement patterns
 */
exports.getEngagementPatterns = async (tenantId, options = {}) => {
  const { days = 30 } = options;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  const responses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    createdAt: { $gte: startDate }
  })
    .select("createdAt survey answers completionTime")
    .lean();

  // Analyze by hour of day
  const hourlyDistribution = Array(24).fill(0);
  // Analyze by day of week
  const dailyDistribution = Array(7).fill(0);

  responses.forEach(r => {
    const date = new Date(r.createdAt);
    hourlyDistribution[date.getHours()]++;
    dailyDistribution[date.getDay()]++;
  });

  // Find peak times
  const peakHour = hourlyDistribution.indexOf(Math.max(...hourlyDistribution));
  const peakDay = dailyDistribution.indexOf(Math.max(...dailyDistribution));

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Calculate completion rate
  const completionTimes = responses.filter(r => r.completionTime).map(r => r.completionTime);
  const avgCompletionTime = completionTimes.length 
    ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
    : null;

  return {
    tenantId,
    period: { days, startDate, endDate: new Date() },
    hourlyDistribution: hourlyDistribution.map((count, hour) => ({ hour, count })),
    dailyDistribution: dailyDistribution.map((count, idx) => ({ day: dayNames[idx], count })),
    peakEngagement: {
      hour: peakHour,
      hourFormatted: `${peakHour}:00 - ${peakHour + 1}:00`,
      day: dayNames[peakDay],
      dayIndex: peakDay
    },
    avgCompletionTime,
    totalResponses: responses.length
  };
};

/**
 * Get comparative trend between two periods
 */
exports.getComparativeTrend = async (tenantId, options = {}) => {
  const { currentDays = 30, previousDays = 30 } = options;

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(now.getDate() - currentDays);

  const previousEnd = new Date(currentStart);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousEnd.getDate() - previousDays);

  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  const [currentResponses, previousResponses] = await Promise.all([
    SurveyResponse.find({
      survey: { $in: surveyIds },
      createdAt: { $gte: currentStart, $lte: now }
    }).select("rating score").lean(),
    SurveyResponse.find({
      survey: { $in: surveyIds },
      createdAt: { $gte: previousStart, $lte: previousEnd }
    }).select("rating score").lean()
  ]);

  const currentMetrics = {
    responseCount: currentResponses.length,
    avgRating: calculateAverage(currentResponses, "rating"),
    avgScore: calculateAverage(currentResponses, "score")
  };

  const previousMetrics = {
    responseCount: previousResponses.length,
    avgRating: calculateAverage(previousResponses, "rating"),
    avgScore: calculateAverage(previousResponses, "score")
  };

  return {
    tenantId,
    current: {
      period: { start: currentStart, end: now, days: currentDays },
      ...currentMetrics
    },
    previous: {
      period: { start: previousStart, end: previousEnd, days: previousDays },
      ...previousMetrics
    },
    changes: {
      responseCount: calculateChange(currentMetrics.responseCount, previousMetrics.responseCount),
      avgRating: calculateChange(currentMetrics.avgRating, previousMetrics.avgRating),
      avgScore: calculateChange(currentMetrics.avgScore, previousMetrics.avgScore)
    }
  };
};

// ===== HELPER FUNCTIONS =====

function groupByInterval(items, interval) {
  const groups = {};

  items.forEach(item => {
    const date = new Date(item.createdAt);
    let key;

    switch (interval) {
      case "week":
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split("T")[0];
        break;
      case "month":
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        break;
      default: // day
        key = date.toISOString().split("T")[0];
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  return Object.entries(groups)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, items]) => ({ date, items }));
}

function getIntervalGrouping(interval) {
  switch (interval) {
    case "week":
      return {
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" }
      };
    case "month":
      return {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" }
      };
    default: // day
      return {
        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
      };
  }
}

function fillDateGaps(data, startDate, endDate, interval) {
  const filled = [];
  const dataMap = {};

  data.forEach(item => {
    const key = typeof item._id === "object" 
      ? `${item._id.year}-${String(item._id.month || item._id.week).padStart(2, "0")}`
      : item._id;
    dataMap[key] = item;
  });

  const current = new Date(startDate);
  while (current <= endDate) {
    let key;
    switch (interval) {
      case "month":
        key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
        current.setMonth(current.getMonth() + 1);
        break;
      case "week":
        key = current.toISOString().split("T")[0];
        current.setDate(current.getDate() + 7);
        break;
      default:
        key = current.toISOString().split("T")[0];
        current.setDate(current.getDate() + 1);
    }

    filled.push({
      date: key,
      count: dataMap[key]?.count || 0,
      avgRating: dataMap[key]?.avgRating || 0
    });
  }

  return filled;
}

function calculateAverage(items, field) {
  const validItems = items.filter(i => i[field] != null && !isNaN(i[field]));
  if (!validItems.length) return 0;
  return Number((validItems.reduce((sum, i) => sum + Number(i[field]), 0) / validItems.length).toFixed(2));
}

function calculateChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function calculateGrowthRate(trend) {
  if (trend.length < 2) return 0;
  const first = trend[0]?.count || 0;
  const last = trend[trend.length - 1]?.count || 0;
  if (first === 0) return last > 0 ? 100 : 0;
  return Number((((last - first) / first) * 100).toFixed(1));
}

module.exports = exports;
