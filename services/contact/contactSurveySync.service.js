// services/contact/contactSurveySync.service.js
/**
 * Syncs survey response/invitation data to Contact.surveyStats
 * This enables behavior-based audience segmentation
 */

const Contact = require("../../models/ContactManagement");
const SurveyResponse = require("../../models/SurveyResponse");
const SurveyInvite = require("../../models/SurveyInvite");
const Logger = require("../../utils/logger");

/**
 * Determine NPS category from score (0-10)
 * Promoter: 9-10, Passive: 7-8, Detractor: 0-6
 */
function getNpsCategory(score) {
  if (score === null || score === undefined) return null;
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/**
 * Find contact by email (case-insensitive)
 */
async function findContactByEmail(tenantId, email) {
  if (!tenantId || !email) return null;
  
  return Contact.findOne({
    tenantId,
    email: { $regex: new RegExp(`^${email}$`, "i") },
  });
}

/**
 * Update contact stats after a survey response
 * Called when a survey response is submitted
 */
async function onSurveyResponse({
  tenantId,
  email,
  npsScore,
  rating,
  responseDate = new Date(),
}) {
  try {
    if (!tenantId || !email) {
      Logger.warn("contactSurveySync", "Missing tenantId or email", {
        context: { tenantId, email },
      });
      return null;
    }

    const contact = await findContactByEmail(tenantId, email);

    if (!contact) {
      Logger.debug("contactSurveySync", "Contact not found for response sync", {
        context: { tenantId, email },
      });
      return null;
    }

    // Initialize surveyStats if not present
    if (!contact.surveyStats) {
      contact.surveyStats = {
        invitedCount: 0,
        respondedCount: 0,
      };
    }

    const prevRespondedCount = contact.surveyStats.respondedCount || 0;

    // Increment response count
    contact.surveyStats.respondedCount = prevRespondedCount + 1;

    // Update last response date
    contact.surveyStats.lastResponseDate = responseDate;

    // Update NPS if provided (score is 0-10 scale)
    if (npsScore !== undefined && npsScore !== null) {
      const prevAvg = contact.surveyStats.avgNpsScore;
      
      contact.surveyStats.latestNpsScore = npsScore;
      contact.surveyStats.npsCategory = getNpsCategory(npsScore);

      // Recalculate average NPS
      if (prevAvg !== undefined && prevAvg !== null && prevRespondedCount > 0) {
        contact.surveyStats.avgNpsScore =
          (prevAvg * prevRespondedCount + npsScore) / contact.surveyStats.respondedCount;
      } else {
        contact.surveyStats.avgNpsScore = npsScore;
      }
    }

    // Update rating if provided (rating is 1-5 scale)
    if (rating !== undefined && rating !== null) {
      const prevAvg = contact.surveyStats.avgRating;

      contact.surveyStats.latestRating = rating;

      // Recalculate average rating
      if (prevAvg !== undefined && prevAvg !== null && prevRespondedCount > 0) {
        contact.surveyStats.avgRating =
          (prevAvg * prevRespondedCount + rating) / contact.surveyStats.respondedCount;
      } else {
        contact.surveyStats.avgRating = rating;
      }
    }

    // Update last activity
    contact.lastActivity = responseDate;

    await contact.save();

    Logger.info("contactSurveySync", "Contact survey stats updated (response)", {
      context: {
        contactId: contact._id,
        email,
        respondedCount: contact.surveyStats.respondedCount,
        npsScore,
        npsCategory: contact.surveyStats.npsCategory,
      },
    });

    return contact;
  } catch (err) {
    Logger.error("contactSurveySync", "Failed to sync response to contact", {
      error: err,
      context: { tenantId, email },
    });
    return null;
  }
}

/**
 * Update contact stats after a survey invitation
 * Called when a survey invite is sent
 */
async function onSurveyInvite({
  tenantId,
  email,
  invitedDate = new Date(),
}) {
  try {
    if (!tenantId || !email) return null;

    const contact = await findContactByEmail(tenantId, email);

    if (!contact) {
      Logger.debug("contactSurveySync", "Contact not found for invite sync", {
        context: { tenantId, email },
      });
      return null;
    }

    // Initialize surveyStats if not present
    if (!contact.surveyStats) {
      contact.surveyStats = {
        invitedCount: 0,
        respondedCount: 0,
      };
    }

    // Increment invited count
    contact.surveyStats.invitedCount = (contact.surveyStats.invitedCount || 0) + 1;

    // Update last invited date
    contact.surveyStats.lastInvitedDate = invitedDate;

    await contact.save();

    Logger.info("contactSurveySync", "Contact survey stats updated (invite)", {
      context: {
        contactId: contact._id,
        email,
        invitedCount: contact.surveyStats.invitedCount,
      },
    });

    return contact;
  } catch (err) {
    Logger.error("contactSurveySync", "Failed to sync invite to contact", {
      error: err,
      context: { tenantId, email },
    });
    return null;
  }
}

/**
 * Batch update for multiple invites (used in bulk distribution)
 */
async function onBulkSurveyInvites({ tenantId, emails, invitedDate = new Date() }) {
  if (!tenantId || !emails?.length) return { updated: 0 };

  try {
    const result = await Contact.updateMany(
      {
        tenantId,
        email: { $in: emails.map(e => new RegExp(`^${e}$`, "i")) },
      },
      {
        $inc: { "surveyStats.invitedCount": 1 },
        $set: { "surveyStats.lastInvitedDate": invitedDate },
      }
    );

    Logger.info("contactSurveySync", "Bulk invite sync completed", {
      context: { tenantId, emailCount: emails.length, modifiedCount: result.modifiedCount },
    });

    return { updated: result.modifiedCount };
  } catch (err) {
    Logger.error("contactSurveySync", "Bulk invite sync failed", {
      error: err,
      context: { tenantId, emailCount: emails.length },
    });
    return { updated: 0, error: err.message };
  }
}

/**
 * Full recalculation of survey stats for a single contact
 * Use for data migrations or corrections
 */
async function recalculateContactStats({ tenantId, contactId }) {
  try {
    const contact = await Contact.findOne({ _id: contactId, tenantId });
    if (!contact) return null;

    const email = contact.email.toLowerCase();

    // Count invitations for this contact
    const inviteCount = await SurveyInvite.countDocuments({
      tenant: tenantId,
      "contact.email": { $regex: new RegExp(`^${email}$`, "i") },
    });

    // Get last invite date
    const lastInvite = await SurveyInvite.findOne({
      tenant: tenantId,
      "contact.email": { $regex: new RegExp(`^${email}$`, "i") },
    }).sort({ createdAt: -1 });

    // Aggregate responses linked to invites for this email
    const responseAgg = await SurveyInvite.aggregate([
      {
        $match: {
          tenant: tenantId,
          "contact.email": { $regex: new RegExp(`^${email}$`, "i") },
          status: "responded",
        },
      },
      {
        $lookup: {
          from: "surveyresponses",
          let: { surveyId: "$survey", respondedAt: "$respondedAt" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$survey", "$$surveyId"] },
                    { $eq: ["$tenant", tenantId] },
                  ],
                },
              },
            },
          ],
          as: "responses",
        },
      },
      { $unwind: "$responses" },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          avgNps: { $avg: "$responses.score" },
          avgRating: { $avg: "$responses.rating" },
          lastResponse: { $max: "$responses.submittedAt" },
          latestNps: { $last: "$responses.score" },
          latestRating: { $last: "$responses.rating" },
        },
      },
    ]);

    const stats = responseAgg[0] || {};

    contact.surveyStats = {
      invitedCount: inviteCount,
      respondedCount: stats.count || 0,
      lastResponseDate: stats.lastResponse || null,
      lastInvitedDate: lastInvite?.createdAt || null,
      latestNpsScore: stats.latestNps ?? null,
      avgNpsScore: stats.avgNps ?? null,
      latestRating: stats.latestRating ?? null,
      avgRating: stats.avgRating ?? null,
      npsCategory: getNpsCategory(stats.latestNps),
    };

    await contact.save();

    Logger.info("contactSurveySync", "Contact stats recalculated", {
      context: { contactId, surveyStats: contact.surveyStats },
    });

    return contact;
  } catch (err) {
    Logger.error("contactSurveySync", "Recalculate failed", {
      error: err,
      context: { tenantId, contactId },
    });
    return null;
  }
}

/**
 * Batch recalculate for all contacts in a tenant
 * Use for initial migration or periodic refresh
 */
async function recalculateAllContactStats({ tenantId, batchSize = 100 }) {
  const contacts = await Contact.find({ tenantId }).select("_id email");

  let processed = 0;
  const errors = [];

  for (const contact of contacts) {
    try {
      await recalculateContactStats({ tenantId, contactId: contact._id });
      processed++;
    } catch (err) {
      errors.push({ contactId: contact._id, email: contact.email, error: err.message });
    }
  }

  Logger.info("contactSurveySync", "Batch recalculation completed", {
    context: { tenantId, processed, errorCount: errors.length },
  });

  return { processed, errors };
}

module.exports = {
  onSurveyResponse,
  onSurveyInvite,
  onBulkSurveyInvites,
  recalculateContactStats,
  recalculateAllContactStats,
  getNpsCategory,
};