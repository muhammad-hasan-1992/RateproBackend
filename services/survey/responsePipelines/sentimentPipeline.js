// services/survey/responsePipelines/sentimentPipeline.js
const SurveyResponse = require("../../../models/SurveyResponse");
const Survey = require("../../../models/Survey");
const aiClient = require("../../../utils/aiClient");
const Logger = require("../../../utils/auditLog");

module.exports.start = async (responseId) => {
  const response = await SurveyResponse.findById(responseId);
  
  if (!response) return;

  const survey = await Survey.findById(response.survey);

  const feedbackText = (response.answers || [])
    .map(a => a.answer)
    .join(" ");

  if (!feedbackText.trim()) return;

  Logger.info("aiSentiment", "AI sentiment analysis started", {
    context: { responseId, surveyId: survey._id }
  });

  const ai = await aiClient.complete({
    contents: [{ parts: [{ text: feedbackText }] }],
    maxTokens: 300
  });

  let analysis = {};

  try {
    analysis = JSON.parse(ai.text);
  } catch (e) {
    analysis = { sentiment: "neutral" };
  }

  response.sentiment = analysis.sentiment || "neutral";
  response.sentimentMeta = analysis;
  await response.save();

  Logger.info("aiSentiment", "AI sentiment updated", {
    context: { 
      responseId, 
      surveyId: survey._id,
      sentiment: response.sentiment 
    }
  });
};