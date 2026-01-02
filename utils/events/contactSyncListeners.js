// utils/events/contactSyncListeners.js
/**
 * Event listeners for syncing survey activity to Contacts
 * Import this in server.js to activate
 */

const responseEvents = require("./responseEvents");
const { onSurveyResponse } = require("../../services/contact/contactSurveySync.service");
const SurveyInvite = require("../../models/SurveyInvite");
const SurveyResponse = require("../../models/SurveyResponse");

// Listen for response.created event (from anonymous responses)
responseEvents.on("response.created", async (data) => {
  try {
    const { responseId, surveyId, tenantId, isAnonymous } = data;

    // For anonymous responses, we can't link to a contact directly
    // But if it came via an invite, we can try to find it
    if (isAnonymous) {
      // Anonymous responses typically don't have invite context
      // Skip or handle differently
      return;
    }

    // Get response details
    const response = await SurveyResponse.findById(responseId);
    if (!response) return;

    // Try to find the invite that led to this response
    const invite = await SurveyInvite.findOne({
      survey: surveyId,
      tenant: tenantId,
      status: "responded",
      respondedAt: { $gte: new Date(Date.now() - 60000) }, // Within last minute
    }).sort({ respondedAt: -1 });

    if (invite?.contact?.email) {
      await onSurveyResponse({
        tenantId,
        email: invite.contact.email,
        npsScore: response.score,
        rating: response.rating,
        responseDate: response.submittedAt,
      });
    }
  } catch (err) {
    console.error("[contactSyncListeners] Error syncing response:", err);
  }
});

console.log("[contactSyncListeners] Event listeners registered");

module.exports = {};