// services/analytics/exportService.js
const SurveyResponse = require("../../models/SurveyResponse");
const Survey = require("../../models/Survey");
const { Parser } = require("json2csv");
const PDFDocument = require("pdfkit");
const mongoose = require("mongoose");
const npsService = require("./npsService");
const sentimentService = require("./sentimentService");
const trendService = require("./trendService");

/**
 * Export survey responses to CSV
 */
exports.exportResponsesCSV = async (surveyId, options = {}) => {
  const { startDate, endDate, includeAnalysis = false } = options;

  const survey = await Survey.findById(surveyId).lean();
  if (!survey) throw new Error("Survey not found");

  const query = { survey: new mongoose.Types.ObjectId(surveyId) };
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const responses = await SurveyResponse.find(query)
    .populate("user", "name email")
    .sort({ createdAt: -1 })
    .lean();

  // Build flat structure for CSV
  const flatResponses = await Promise.all(responses.map(async (response) => {
    const row = {
      responseId: response._id.toString(),
      submittedAt: response.createdAt?.toISOString(),
      isAnonymous: response.isAnonymous,
      respondentName: response.isAnonymous ? "Anonymous" : response.user?.name || "Unknown",
      respondentEmail: response.isAnonymous ? "" : response.user?.email || "",
      rating: response.rating || "",
      npsScore: response.score || "",
      review: response.review || ""
    };

    // Add each question's answer as a column
    survey.questions.forEach((q, idx) => {
      const answer = response.answers?.find(
        a => a.questionId?.toString() === q._id?.toString() || a.questionId === q.id
      );
      row[`Q${idx + 1}_${q.questionText.substring(0, 30)}`] = formatAnswer(answer?.answer);
    });

    // Optionally include sentiment analysis
    if (includeAnalysis) {
      const analysis = await sentimentService.analyzeResponseSentiment(response);
      row.sentiment = analysis.sentiment;
      row.sentimentScore = analysis.sentimentScore;
      row.isComplaint = analysis.classification?.isComplaint;
      row.isPraise = analysis.classification?.isPraise;
    }

    return row;
  }));

  const parser = new Parser({ fields: Object.keys(flatResponses[0] || {}) });
  const csv = parser.parse(flatResponses);

  return {
    filename: `${survey.title.replace(/\s+/g, "_")}_responses_${new Date().toISOString().split("T")[0]}.csv`,
    content: csv,
    contentType: "text/csv",
    recordCount: flatResponses.length
  };
};

/**
 * Export survey analytics to PDF (REFACTORED with Template System)
 * Now uses AnalyticsReportTemplate for professional branding and layout.
 */
exports.exportAnalyticsPDF = async (surveyId, options = {}) => {
  const { days = 30 } = options;

  const survey = await Survey.findById(surveyId).populate("tenant", "name").lean();
  if (!survey) throw new Error("Survey not found");

  // Import template class
  const AnalyticsReportTemplate = require('../export/AnalyticsReportTemplate');

  // Gather all analytics data with error handling
  let nps, csi, sentiment, volumeTrend;
  try {
    [nps, csi, sentiment, volumeTrend] = await Promise.all([
      npsService.getSurveyNPS(surveyId, { days }),
      npsService.getSurveyCSI(surveyId, { days }),
      sentimentService.getSurveySentimentAnalysis(surveyId, { limit: 100 }),
      trendService.getSurveyVolumeTrend(surveyId, { days })
    ]);
  } catch (err) {
    console.error("Error gathering analytics data for PDF:", err);
    nps = { score: 0, promoters: 0, detractors: 0, passives: 0 };
    csi = { score: 0, averageRating: 0 };
    sentiment = { sentimentDistribution: {}, complaintsCount: 0, praisesCount: 0 };
    volumeTrend = { totalResponses: 0, trend: [] };
  }

  // Prepare analytics data for template
  const analyticsData = {
    summary: {
      totalResponses: volumeTrend?.totalResponses || 0,
      completionRate: survey.completionRate || 0,
      avgResponseTime: 'N/A',
    },
    nps: {
      score: nps?.score || 0,
      promoters: nps?.promoters || 0,
      passives: nps?.passives || 0,
      detractors: nps?.detractors || 0,
      promoterPercent: nps?.distribution?.promoters || 0,
      passivePercent: nps?.distribution?.passives || 0,
      detractorPercent: nps?.distribution?.detractors || 0,
    },
    csi: {
      score: csi?.score || 0,
      averageRating: csi?.averageRating || 0,
      totalRatings: csi?.totalRatings || 0,
    },
    sentiment: {
      overall: sentiment?.overallSentiment || 'Neutral',
      confidence: sentiment?.confidence || 0,
      distribution: {
        positive: sentiment?.sentimentDistribution?.positive || 0,
        neutral: sentiment?.sentimentDistribution?.neutral || 0,
        negative: sentiment?.sentimentDistribution?.negative || 0,
        positivePercent: sentiment?.sentimentDistribution?.positivePercent || 0,
        neutralPercent: sentiment?.sentimentDistribution?.neutralPercent || 0,
        negativePercent: sentiment?.sentimentDistribution?.negativePercent || 0,
      },
    },
    trend: {
      totalResponses: volumeTrend?.totalResponses || 0,
      period: `Last ${days} days`,
      peakDate: volumeTrend?.peakDate || null,
      peakCount: volumeTrend?.peakCount || 0,
    },
  };

  // Create template with branding
  const template = new AnalyticsReportTemplate({
    title: 'Survey Analytics Report',
    subtitle: survey.title,
    survey: survey,
    analytics: analyticsData,
  });

  // Initialize tenant branding
  const tenantId = survey.tenant?._id || survey.tenant;
  await template.initBranding(tenantId);

  // Build the report
  await template.build();

  // Get PDF document and collect chunks
  const doc = template.getDocument();
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));

  // Finalize and end
  template.end();

  return new Promise((resolve) => {
    doc.on("end", () => {
      resolve({
        filename: `${survey.title.replace(/\s+/g, "_")}_analytics_${new Date().toISOString().split("T")[0]}.pdf`,
        content: Buffer.concat(chunks),
        contentType: "application/pdf"
      });
    });
  });
};

/**
 * Export tenant-wide analytics summary to CSV
 */
exports.exportTenantSummaryCSV = async (tenantId, options = {}) => {
  const { days = 30 } = options;

  const surveys = await Survey.find({ tenant: tenantId })
    .select("_id title status createdAt totalResponses")
    .lean();

  const summaryRows = await Promise.all(surveys.map(async (survey) => {
    const [nps, csi] = await Promise.all([
      npsService.getSurveyNPS(survey._id, { days }),
      npsService.getSurveyCSI(survey._id, { days })
    ]);

    return {
      surveyId: survey._id.toString(),
      surveyTitle: survey.title,
      status: survey.status,
      createdAt: survey.createdAt?.toISOString(),
      totalResponses: survey.totalResponses || 0,
      npsScore: nps.score,
      npsPromoters: nps.promoters,
      npsDetractors: nps.detractors,
      csiScore: csi.score,
      avgRating: csi.averageRating
    };
  }));

  const parser = new Parser();
  const csv = parser.parse(summaryRows);

  return {
    filename: `tenant_analytics_summary_${new Date().toISOString().split("T")[0]}.csv`,
    content: csv,
    contentType: "text/csv",
    surveyCount: summaryRows.length
  };
};

/**
 * Export response data for a specific contact (CRM enrichment)
 * Client Requirement 6: Invited/Identified Response Handling
 */
exports.exportContactFeedbackHistory = async (contactEmail, tenantId, options = {}) => {
  const surveys = await Survey.find({ tenant: tenantId }).select("_id title").lean();
  const surveyIds = surveys.map(s => s._id);
  const surveyMap = Object.fromEntries(surveys.map(s => [s._id.toString(), s.title]));

  const responses = await SurveyResponse.find({
    survey: { $in: surveyIds },
    isAnonymous: false
  })
    .populate("user", "email")
    .sort({ createdAt: -1 })
    .lean();

  // Filter by contact email
  const contactResponses = responses.filter(r => r.user?.email === contactEmail);

  const historyRows = await Promise.all(contactResponses.map(async (response) => {
    const analysis = await sentimentService.analyzeResponseSentiment(response);

    return {
      date: response.createdAt?.toISOString(),
      surveyTitle: surveyMap[response.survey?.toString()] || "Unknown",
      rating: response.rating || "",
      npsScore: response.score || "",
      sentiment: analysis.sentiment,
      review: response.review?.substring(0, 200) || ""
    };
  }));

  const parser = new Parser();
  const csv = parser.parse(historyRows);

  return {
    filename: `contact_${contactEmail.replace("@", "_at_")}_feedback_history.csv`,
    content: csv,
    contentType: "text/csv",
    recordCount: historyRows.length
  };
};

// Helper to format answers for CSV
function formatAnswer(answer) {
  if (answer === null || answer === undefined) return "";
  if (Array.isArray(answer)) return answer.join("; ");
  if (typeof answer === "object") return JSON.stringify(answer);
  return String(answer);
}

module.exports = exports;
