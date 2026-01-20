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
 * Export survey analytics to PDF
 */
exports.exportAnalyticsPDF = async (surveyId, options = {}) => {
  const { days = 30 } = options;

  const survey = await Survey.findById(surveyId).populate("tenant", "name").lean();
  if (!survey) throw new Error("Survey not found");

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
    // Use default empty values if analytics fail
    nps = { score: 0, promoters: 0, detractors: 0, passives: 0, distribution: { promoters: 0, passives: 0, detractors: 0 } };
    csi = { score: 0, averageRating: 0 };
    sentiment = { sentimentDistribution: { positive: 0, neutral: 0, negative: 0 }, complaintsCount: 0, praisesCount: 0, suggestionsCount: 0, topKeywords: [], topThemes: [] };
    volumeTrend = { totalResponses: 0, trend: [] };
  }

  // Ensure null-safe access with defaults
  const sentimentDist = sentiment?.sentimentDistribution || { positive: 0, neutral: 0, negative: 0 };
  const npsDist = nps?.distribution || { promoters: 0, passives: 0, detractors: 0 };
  const trendData = volumeTrend?.trend || [];
  const keywords = sentiment?.topKeywords || [];
  const themes = sentiment?.topThemes || [];

  // Create PDF document
  const doc = new PDFDocument({ margin: 50 });
  const chunks = [];

  doc.on("data", chunk => chunks.push(chunk));

  // Header
  doc
    .fontSize(24)
    .text("Survey Analytics Report", { align: "center" })
    .moveDown(0.5);

  doc
    .fontSize(14)
    .text(survey.title, { align: "center" })
    .moveDown(0.3);

  doc
    .fontSize(10)
    .fillColor("#666")
    .text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" })
    .text(`Period: Last ${days} days`, { align: "center" })
    .moveDown(1);

  // Executive Summary
  doc
    .fillColor("#000")
    .fontSize(16)
    .text("Executive Summary", { underline: true })
    .moveDown(0.5);

  doc.fontSize(11);
  doc.text(`Total Responses: ${volumeTrend?.totalResponses || 0}`, { continued: false });
  doc.text(`NPS Score: ${nps?.score || 0} (${nps?.promoters || 0} promoters, ${nps?.detractors || 0} detractors)`);
  doc.text(`Customer Satisfaction Index: ${csi?.score || 0}% (Avg Rating: ${csi?.averageRating || 0}/5)`);
  doc.text(`Sentiment: ${sentimentDist.positive || 0} positive, ${sentimentDist.negative || 0} negative`);
  doc.moveDown(1);

  // NPS Breakdown
  doc
    .fontSize(16)
    .text("Net Promoter Score (NPS)", { underline: true })
    .moveDown(0.5);

  doc.fontSize(11);
  doc.text(`Score: ${nps?.score || 0}`);
  doc.text(`Promoters (9-10): ${nps?.promoters || 0} (${npsDist.promoters || 0}%)`);
  doc.text(`Passives (7-8): ${nps?.passives || 0} (${npsDist.passives || 0}%)`);
  doc.text(`Detractors (0-6): ${nps?.detractors || 0} (${npsDist.detractors || 0}%)`);
  doc.moveDown(1);

  // Sentiment Analysis
  doc
    .fontSize(16)
    .text("Sentiment Analysis", { underline: true })
    .moveDown(0.5);

  doc.fontSize(11);
  doc.text(`Positive: ${sentimentDist.positive || 0}`);
  doc.text(`Neutral: ${sentimentDist.neutral || 0}`);
  doc.text(`Negative: ${sentimentDist.negative || 0}`);
  doc.text(`Complaints: ${sentiment?.complaintsCount || 0}`);
  doc.text(`Praises: ${sentiment?.praisesCount || 0}`);
  doc.text(`Suggestions: ${sentiment?.suggestionsCount || 0}`);
  doc.moveDown(0.5);

  if (keywords.length > 0) {
    doc.text("Top Keywords: " + keywords.slice(0, 5).map(k => k.keyword || k.word || k).join(", "));
  }
  if (themes.length > 0) {
    doc.text("Top Themes: " + themes.slice(0, 5).map(t => t.theme || t.name || t).join(", "));
  }
  doc.moveDown(1);

  // Response Volume
  doc
    .fontSize(16)
    .text("Response Volume Trend", { underline: true })
    .moveDown(0.5);

  doc.fontSize(11);
  if (trendData.length > 0) {
    trendData.slice(-7).forEach(t => {
      doc.text(`${t.date || 'N/A'}: ${t.count || 0} responses`);
    });
  } else {
    doc.text("No response trend data available for this period.");
  }

  // Footer
  doc.moveDown(2);
  doc
    .fontSize(9)
    .fillColor("#999")
    .text("Generated by RatePro Analytics", { align: "center" });

  doc.end();

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
