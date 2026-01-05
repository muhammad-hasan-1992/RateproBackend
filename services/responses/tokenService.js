// services/responses/tokenService.js
const mongoose = require("mongoose");
const SurveyInvite = require("../../models/SurveyInvite");
const User = require("../../models/User");
const generateSurveyToken = require("../../utils/generateSurveyToken");
const Logger = require("../../utils/auditLog");

/**
 * Recipient shape we accept:
 * { userId?: string, name?: string, email?: string, phone?: string }
 *
 * Expectations:
 * - Either userId OR (email || phone) must be present.
 * - tenantId and survey must be provided (survey can be full doc or id).
 *
 * Returns: { createdCount, skippedExisting, invites: [createdInvites], errors: [...] }
 */

const MAX_TOKEN_GEN_ATTEMPTS = 5;

async function ensureUniqueToken() {
  for (let i = 0; i < MAX_TOKEN_GEN_ATTEMPTS; i++) {
    const token = generateSurveyToken();
    // quick check — chance of collision is astronomically low but we check once
    // to avoid duplicate key errors on insertMany
    // Note: this is best-effort; unique index still protects us.
    // We use findOne with index on token.
    // Wrap in try/catch for safety.
    try {
      const exists = await SurveyInvite.findOne({ token }).select("_id").lean();
      if (!exists) return token;
    } catch (err) {
      // on DB error, just try another token (don't crash here)
      Logger.warn("ensureUniqueToken: temporary DB error when checking token", { error: err.message });
    }
  }
  // fallback, return token anyway — duplicate key will be handled by DB
  return generateSurveyToken();
}

/**
 * Create invites for a given survey.
 *
 * @param {Object|String} surveyOrId - Survey mongoose doc or id
 * @param {Array<Object>} recipients - array of recipient objects
 * @param {String} tenantId - tenant ObjectId string
 * @param {ObjectId|String|null} createdBy - user id who initiated (optional)
 *
 * @returns {Object} summary
 */
async function generateInvitesForSurvey(surveyOrId, recipients = [], tenantId, createdBy = null) {
  const summary = { createdCount: 0, skippedExisting: 0, invites: [], errors: [] };

  if (!surveyOrId) {
    throw new Error("surveyOrId is required");
  }
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  // normalize survey id
  const surveyId = (typeof surveyOrId === "string" || surveyOrId instanceof mongoose.Types.ObjectId)
    ? surveyOrId
    : surveyOrId._id;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return summary; // nothing to do
  }

  // Normalize recipients: unique by (userId) or (email) or (phone)
  const normalized = recipients.map(r => {
    return {
      userId: r.userId ? String(r.userId) : null,
      email: r.email ? String(r.email).toLowerCase() : null,
      phone: r.phone ? String(r.phone) : null,
      name: r.name || null
    };
  });

  // Build dedupe keys
  const keysSet = new Set();
  const uniqueRecipients = [];
  for (const r of normalized) {
    const key = r.userId ? `u:${r.userId}` : (r.email ? `e:${r.email}` : (r.phone ? `p:${r.phone}` : null));
    if (!key) {
      summary.errors.push({ recipient: r, message: "Skipped: missing identifier (userId | email | phone)" });
      continue;
    }
    if (keysSet.has(key)) continue;
    keysSet.add(key);
    uniqueRecipients.push(r);
  }

  // Find existing invites for this survey and tenant to avoid duplicates
  const existingQueryOrs = [];
  for (const r of uniqueRecipients) {
    if (r.userId) existingQueryOrs.push({ user: new mongoose.Types.ObjectId(r.userId) });
    if (r.email) existingQueryOrs.push({ "contact.email": r.email });
    if (r.phone) existingQueryOrs.push({ "contact.phone": r.phone });
  }

  let existingInvites = [];
  if (existingQueryOrs.length > 0) {
    try {
      existingInvites = await SurveyInvite.find({
        survey: surveyId,
        tenant: tenantId,
        $or: existingQueryOrs
      }).lean();
    } catch (err) {
      // If DB read fails, we still attempt create but warn
      Logger.error("generateInvitesForSurvey: Failed to load existing invites", { error: err.message, surveyId, tenantId });
    }
  }

  // Create a quick lookup of existing keys
  const existingKeys = new Set();
  for (const ex of existingInvites) {
    if (ex.user) existingKeys.add(`u:${String(ex.user)}`);
    if (ex.contact?.email) existingKeys.add(`e:${ex.contact.email.toLowerCase()}`);
    if (ex.contact?.phone) existingKeys.add(`p:${ex.contact.phone}`);
  }

  const docsToInsert = [];
  for (const r of uniqueRecipients) {
    const key = r.userId ? `u:${r.userId}` : (r.email ? `e:${r.email}` : `p:${r.phone}`);
    if (existingKeys.has(key)) {
      summary.skippedExisting++;
      continue;
    }

    // build invite doc
    const doc = {
      survey: new mongoose.Types.ObjectId(surveyId),
      tenant: new mongoose.Types.ObjectId(tenantId),
      token: await ensureUniqueToken(),
      status: "sent",
      createdAt: new Date()
    };

    if (r.userId) {
      doc.user = new mongoose.Types.ObjectId(r.userId);
    } else {
      doc.contact = {
        name: r.name || "",
        email: r.email || "",
        phone: r.phone || ""
      };
    }

    // optional meta
    if (createdBy) doc.createdBy = new mongoose.Types.ObjectId(createdBy);

    docsToInsert.push(doc);
  }

  if (docsToInsert.length === 0) {
    return summary;
  }

  try {
    // bulk insert (unordered so failures on single doc won't abort whole op)
    const inserted = await SurveyInvite.insertMany(docsToInsert, { ordered: false });

    summary.createdCount = inserted.length;
    summary.invites = inserted;
    Logger.info("generateInvitesForSurvey: Invites created", { surveyId, tenantId, created: inserted.length });

  } catch (err) {
    // insertMany with ordered:false may throw AggregateError or MongoBulkWriteError when some docs fail.
    // We'll try to extract successes and errors.
    Logger.error("generateInvitesForSurvey: insertMany error", { error: err.message, surveyId, tenantId });

    // If err.insertedDocs available (mongoose returns some), use them
    if (err && Array.isArray(err.insertedDocs)) {
      summary.invites = err.insertedDocs;
      summary.createdCount = err.insertedDocs.length;
    }

    // Attempt to parse writeErrors
    if (err && err.writeErrors && Array.isArray(err.writeErrors)) {
      for (const we of err.writeErrors) {
        summary.errors.push({ index: we.index, errmsg: we.errmsg, code: we.code });
      }
    } else {
      // generic fallback
      summary.errors.push({ message: err.message });
    }
  }

  return summary;
}

module.exports = {
  generateInvitesForSurvey,
  ensureUniqueToken
};