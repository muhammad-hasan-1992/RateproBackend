// services/survey/responsePipelines/actionPipeline.js
const SurveyResponse = require("../../../models/SurveyResponse");
const Action = require("../../../models/Action");
const Survey = require("../../../models/Survey");
const aiClient = require("../../../utils/aiClient");
const Logger = require("../../../utils/auditLog");

module.exports.start = async (responseId) => {
  const response = await SurveyResponse.findById(responseId);
  
  if (!response) return;

  const survey = await Survey.findById(response.survey);

  const text = (response.answers || [])
    .map(a => a.answer)
    .join(" ");

  if (!text.trim()) return;

  const ai = await aiClient.complete({
    prompt: `Customer feedback: ${text}\nGenerate 1 actionable task in JSON:`,
    maxTokens: 300
  });

  let data = {};
  try {
    data = JSON.parse(ai.text);
  } catch {
    data = {
      description: `Auto: ${text.substring(0, 60)}...`,
      priority: "high"
    };
  }

  const action = await Action.create({
    title: "Customer Issue",
    description: data.description,
    priority: data.priority || "medium",
    tenant: survey.tenant,
    metadata: { responseId }
  });

  Logger.info("autoAction", "Auto action created", {
    context: {
      responseId,
      actionId: action._id,
      surveyId: survey._id,
      tenantId: survey.tenant
    }
  });
};