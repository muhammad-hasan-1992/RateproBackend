// services/analytics/npsService.js
const SurveyResponse = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const mongoose = require("mongoose");

/**
 * Calculate NPS Score from responses
 * Client Requirement 3: Quantitative Feedback Interpretation
 * 
 * NPS Formula: ((Promoters - Detractors) / Total) * 100
 * - Promoters: score 9-10
 * - Passives: score 7-8  
 * - Detractors: score 0-6
 */
exports.calculateNPS = (responses) => {
  if (!responses || !responses.length) {
    return { 
      score: 0, 
      promoters: 0, 
      detractors: 0, 
      passives: 0,
      totalResponses: 0,
      distribution: { promoters: 0, passives: 0, detractors: 0 }
    };
  }

  let promoters = 0;
  let detractors = 0;
  let passives = 0;
  let validResponses = 0;

  responses.forEach(r => {
    // Support both 'score' (0-10 NPS) and 'npsScore' fields
    const score = Number(r.score ?? r.npsScore);
    
    if (!isNaN(score) && score >= 0 && score <= 10) {
      validResponses++;
      if (score >= 9) promoters++;
      else if (score <= 6) detractors++;
      else passives++;
    }
  });

  if (validResponses === 0) {
    return { 
      score: 0, 
      promoters: 0, 
      detractors: 0, 
      passives: 0,
      totalResponses: 0,
      distribution: { promoters: 0, passives: 0, detractors: 0 }
    };
  }

  const npsScore = ((promoters - detractors) / validResponses) * 100;

  return {
    score: Number(npsScore.toFixed(2)),
    promoters,
    detractors,
    passives,
    totalResponses: validResponses,
    distribution: {
      promoters: Number(((promoters / validResponses) * 100).toFixed(1)),
      passives: Number(((passives / validResponses) * 100).toFixed(1)),
      detractors: Number(((detractors / validResponses) * 100).toFixed(1))
    }
  };
};

/**
 * Get NPS for a specific survey
 */
exports.getSurveyNPS = async (surveyId, options = {}) => {
  const { startDate, endDate } = options;

  const query = { survey: new mongoose.Types.ObjectId(surveyId) };
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const responses = await SurveyResponse.find(query)
    .select("score npsScore createdAt")
    .lean();

  const nps = this.calculateNPS(responses);

  return {
    surveyId,
    ...nps,
    period: { startDate, endDate },
    calculatedAt: new Date()
  };
};

/**
 * Get NPS for entire tenant
 * Client Requirement 4: Survey-Level Insight Aggregation
 */
exports.getTenantNPS = async (tenantId, options = {}) => {
  const { days = 30 } = options;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get all tenant surveys
  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  const responses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    createdAt: { $gte: startDate }
  })
    .select("score npsScore createdAt")
    .lean();

  const nps = this.calculateNPS(responses);

  return {
    tenantId,
    ...nps,
    period: { days, startDate, endDate: new Date() },
    surveysIncluded: surveys.length,
    calculatedAt: new Date()
  };
};

/**
 * Get NPS trend over time
 */
exports.getNPSTrend = async (surveyId, options = {}) => {
  const { days = 30, interval = "day" } = options;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const responses = await SurveyResponse.find({
    survey: new mongoose.Types.ObjectId(surveyId),
    createdAt: { $gte: startDate }
  })
    .select("score npsScore createdAt")
    .sort({ createdAt: 1 })
    .lean();

  // Group by interval
  const groupedData = {};
  
  responses.forEach(r => {
    let key;
    const date = new Date(r.createdAt);
    
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

    if (!groupedData[key]) groupedData[key] = [];
    groupedData[key].push(r);
  });

  // Calculate NPS for each interval
  const trend = Object.entries(groupedData)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, periodResponses]) => ({
      date,
      ...this.calculateNPS(periodResponses)
    }));

  return {
    surveyId,
    period: { days, interval, startDate, endDate: new Date() },
    trend,
    overallNPS: this.calculateNPS(responses)
  };
};

/**
 * Calculate Customer Satisfaction Index (CSI)
 * Client Requirement 3: Standardized metrics mapping
 * CSI = Average Rating / Max Rating * 100
 */
exports.calculateCSI = (responses, maxRating = 5) => {
  if (!responses || !responses.length) {
    return { score: 0, totalResponses: 0, averageRating: 0 };
  }

  let totalRating = 0;
  let validResponses = 0;

  responses.forEach(r => {
    const rating = Number(r.rating);
    if (!isNaN(rating) && rating >= 1 && rating <= maxRating) {
      totalRating += rating;
      validResponses++;
    }
  });

  if (validResponses === 0) {
    return { score: 0, totalResponses: 0, averageRating: 0 };
  }

  const averageRating = totalRating / validResponses;
  const csi = (averageRating / maxRating) * 100;

  return {
    score: Number(csi.toFixed(2)),
    averageRating: Number(averageRating.toFixed(2)),
    maxRating,
    totalResponses: validResponses
  };
};

/**
 * Get survey CSI
 */
exports.getSurveyCSI = async (surveyId, options = {}) => {
  const { startDate, endDate } = options;

  const query = { survey: new mongoose.Types.ObjectId(surveyId) };
  
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const responses = await SurveyResponse.find(query)
    .select("rating createdAt")
    .lean();

  const csi = this.calculateCSI(responses);

  return {
    surveyId,
    ...csi,
    period: { startDate, endDate },
    calculatedAt: new Date()
  };
};

/**
 * Get tenant-wide CSI
 */
exports.getTenantCSI = async (tenantId, options = {}) => {
  const { days = 30 } = options;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const surveys = await Survey.find({ tenant: tenantId }).select("_id").lean();
  const surveyIds = surveys.map(s => s._id);

  const responses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    createdAt: { $gte: startDate }
  })
    .select("rating createdAt")
    .lean();

  const csi = this.calculateCSI(responses);

  return {
    tenantId,
    ...csi,
    period: { days, startDate, endDate: new Date() },
    surveysIncluded: surveys.length,
    calculatedAt: new Date()
  };
};

/**
 * Get comparative NPS between surveys
 */
exports.compareSurveyNPS = async (surveyIds) => {
  const results = await Promise.all(
    surveyIds.map(async (surveyId) => {
      const survey = await Survey.findById(surveyId).select("title").lean();
      const nps = await this.getSurveyNPS(surveyId);
      return {
        surveyId,
        surveyTitle: survey?.title || "Unknown",
        ...nps
      };
    })
  );

  // Sort by NPS score descending
  results.sort((a, b) => b.score - a.score);

  return {
    comparisons: results,
    bestPerforming: results[0] || null,
    worstPerforming: results[results.length - 1] || null,
    averageNPS: Number(
      (results.reduce((sum, r) => sum + r.score, 0) / results.length || 0).toFixed(2)
    )
  };
};

/**
 * Normalize and validate incoming scores
 * Client Requirement 3: Normalize and validate scores
 */
exports.normalizeScore = (value, inputRange = { min: 0, max: 10 }, outputRange = { min: 0, max: 100 }) => {
  const numValue = Number(value);
  
  if (isNaN(numValue)) return null;
  
  // Clamp to input range
  const clampedValue = Math.max(inputRange.min, Math.min(inputRange.max, numValue));
  
  // Normalize to output range
  const normalized = ((clampedValue - inputRange.min) / (inputRange.max - inputRange.min)) 
    * (outputRange.max - outputRange.min) + outputRange.min;
  
  return Number(normalized.toFixed(2));
};

/**
 * Map rating to standardized category
 */
exports.categorizeRating = (rating, maxRating = 5) => {
  const normalizedRating = rating / maxRating;
  
  if (normalizedRating >= 0.8) return "excellent";
  if (normalizedRating >= 0.6) return "good";
  if (normalizedRating >= 0.4) return "average";
  if (normalizedRating >= 0.2) return "poor";
  return "very_poor";
};
