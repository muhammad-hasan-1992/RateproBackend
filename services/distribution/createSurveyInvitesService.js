// services/distribution/createSurveyInvitesService.js
const crypto = require("crypto");
const SurveyInvite = require("../../models/SurveyInvite");
const { onSurveyInvite, onBulkSurveyInvites } = require("../contact/contactSurveySync.service");

/**
 * Generate unique invite token
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create a single survey invite
 */
async function createSurveyInvite({
  surveyId,
  tenantId,
  contact, // { name, email, phone }
  userId,
  expiresAt,
}) {
  const token = generateToken();

  const invite = await SurveyInvite.create({
    survey: surveyId,
    tenant: tenantId,
    user: userId || null,
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    },
    token,
    status: "sent",
    expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  // 🔥 NEW: Sync to Contact.surveyStats
  if (contact.email) {
    await onSurveyInvite({
      tenantId,
      email: contact.email,
      invitedDate: new Date(),
    });
  }

  return invite;
}

/**
 * Create multiple survey invites (bulk)
 */
async function createBulkSurveyInvites({
  surveyId,
  tenantId,
  contacts, // [{ name, email, phone }]
  expiresAt,
}) {
  const invites = [];
  const emails = [];

  for (const contact of contacts) {
    const token = generateToken();

    invites.push({
      survey: surveyId,
      tenant: tenantId,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
      },
      token,
      status: "sent",
      expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    if (contact.email) {
      emails.push(contact.email);
    }
  }

  const createdInvites = await SurveyInvite.insertMany(invites);

  // 🔥 NEW: Bulk sync to Contact.surveyStats
  if (emails.length > 0) {
    await onBulkSurveyInvites({
      tenantId,
      emails,
      invitedDate: new Date(),
    });
  }

  return createdInvites;
}

module.exports = {
  createSurveyInvite,
  createBulkSurveyInvites,
  generateToken,
};