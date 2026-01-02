// services/survey/inviteService.js
const crypto = require("crypto");
const SurveyInvite = require("../../models/SurveyInvite");
const { onBulkSurveyInvites } = require("../contact/contactSurveySync.service");

module.exports.bulkCreateInvites = async (survey, recipients) => {
  const invites = [];
  const emails = [];

  for (const recipient of recipients) {
    const token = crypto.randomBytes(32).toString("hex");

    await SurveyInvite.create({
      survey: survey._id,
      tenant: survey.tenant,
      contact: {
        name: recipient.name,
        email: recipient.email,
        phone: recipient.phone,
      },
      token,
      status: "sent",
    });

    invites.push({ token, email: recipient.email });

    if (recipient.email) {
      emails.push(recipient.email);
    }
  }

  // 🔥 NEW: Bulk sync to Contact.surveyStats
  if (emails.length > 0) {
    await onBulkSurveyInvites({
      tenantId: survey.tenant,
      emails,
      invitedDate: new Date(),
    });
  }

  return invites;
};