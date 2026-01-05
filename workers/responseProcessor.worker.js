// workers/responseProcessor.worker.js
const responseEvents = require("../utils/events/responseEvents");
const SurveyResponse = require("../models/SurveyResponse");
const Survey = require("../models/Survey");
const { processPostSurveyResponse } = require("../services/postResponse/postResponseProcessor");
const Logger = require("../utils/auditLog");

/**
 * Event listener for response.created events (primarily from anonymous responses)
 * Triggers the same post-processing pipeline as invited responses
 */
responseEvents.on("response.created", async (data) => {
  try {
    const { responseId, surveyId, tenantId, isAnonymous } = data;

    const response = await SurveyResponse.findById(responseId);
    const survey = await Survey.findById(surveyId);

    if (!response || !survey) {
      Logger.warn("responseProcessor", "Response or survey not found for event", {
        context: { responseId, surveyId }
      });
      return;
    }

    // Run the same post-processing pipeline
    await processPostSurveyResponse({
      response,
      survey,
      tenantId
    });

    Logger.info("responseProcessor", "Event-driven post-processing completed", {
      context: { responseId, surveyId, isAnonymous }
    });

  } catch (err) {
    Logger.error("responseProcessor", "Response pipeline failed", {
      error: err,
      context: { responseId: data.responseId }
    });
  }
});

console.log("[responseProcessor.worker] Event listeners registered");