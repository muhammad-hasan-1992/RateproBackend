// controllers/responses/verifyToken.controller.js
const SurveyInvite = require("../../models/SurveyInvite");
const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");
const mongoose = require("mongoose");

/**
 * Verify invite token and return survey for respondent to take.
 * Route: GET /api/responses/verify/:token
 */
exports.verifyInviteToken = async (req, res, next) => {
  const token = req.params.token;
  const requesterIp = req.ip || req.headers["x-forwarded-for"] || req.connection?.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  console.log(`\n${'#'.repeat(60)}`);
  console.log(`🔐 [VerifyToken] TOKEN VERIFICATION REQUEST`);
  console.log(`   Token: ${token?.substring(0, 12)}...`);
  console.log(`   IP: ${requesterIp}`);
  console.log(`   User-Agent: ${userAgent?.substring(0, 50)}...`);
  console.log(`${'#'.repeat(60)}`);

  try {
    if (!token || typeof token !== "string") {
      console.error(`   ❌ Missing or invalid token`);
      Logger.warn("verifyInviteToken", "Missing token", {
        context: { ip: requesterIp },
        req
      });
      return res.status(400).json({ message: "Invalid request" });
    }

    console.log(`\n🔍 [Step 1] Looking up invite...`);
    // Try both possible field names just in case (token vs inviteToken)
    const invite = await SurveyInvite.findOne({
      $or: [{ token }, { inviteToken: token }]
    }).populate({
      path: "survey",
      select: "title description questions settings themeColor thankYouPage status schedule deleted tenant"
    }).lean();

    if (!invite) {
      console.error(`   ❌ Invite not found for token`);
      Logger.warn("verifyInviteToken", "Invalid token", {
        context: { token, ip: requesterIp },
        req
      });
      return res.status(404).json({ message: "Invalid or expired link" });
    }
    console.log(`   ✅ Invite found: ${invite._id}`);
    console.log(`   Status: ${invite.status}`);
    console.log(`   Contact: ${invite.contact?.email || invite.contact?.phone || 'N/A'}`);

    // If invite already responded, return 410 Gone
    if (invite.status === "responded" || invite.respondedAt) {
      console.error(`   ❌ Invite already responded at ${invite.respondedAt}`);
      Logger.info("verifyInviteToken", "Invite already responded", {
        context: { inviteId: invite._id, token, ip: requesterIp },
        req
      });
      return res.status(410).json({ message: "This survey link has already been used." });
    }

    // Basic tenant / survey guard
    console.log(`\n🔍 [Step 2] Validating survey...`);
    const survey = invite.survey;
    if (!survey) {
      console.error(`   ❌ No survey attached to invite`);
      Logger.error("verifyInviteToken", "Invite has no survey attached", {
        context: { inviteId: invite._id },
        req
      });
      return res.status(404).json({ message: "Survey not found for this link" });
    }
    console.log(`   Survey: "${survey.title}"`);
    console.log(`   Status: ${survey.status}`);
    console.log(`   Deleted: ${survey.deleted || false}`);

    if (survey.deleted) {
      console.error(`   ❌ Survey has been deleted`);
      Logger.warn("verifyInviteToken", "Survey deleted", {
        context: { surveyId: survey._id, inviteId: invite._id },
        req
      });
      return res.status(410).json({ message: "Survey is no longer available" });
    }

    // Survey must be active (or scheduled but publishedAt <= now)
    const now = new Date();
    if (survey.status !== "active") {
      // allow access if scheduled and publishedAt already set and <= now
      const publishedAt = survey.schedule?.publishedAt;
      if (!publishedAt || new Date(publishedAt) > now) {
        console.error(`   ❌ Survey not active (status: ${survey.status})`);
        Logger.warn("verifyInviteToken", "Survey not active yet", {
          context: { surveyId: survey._id, status: survey.status, inviteId: invite._id },
          req
        });
        return res.status(403).json({ message: "Survey is not active" });
      }
    }
    console.log(`   ✅ Survey is active`);

    if (survey.schedule?.endDate && new Date(survey.schedule.endDate) < now) {
      console.error(`   ❌ Survey has ended (${survey.schedule.endDate})`);
      Logger.info("verifyInviteToken", "Survey has ended", {
        context: { surveyId: survey._id, endDate: survey.schedule.endDate },
        req
      });
      return res.status(410).json({ message: "This survey has ended and is no longer accepting responses" });
    }

    // If invite has an expiry concept (optional), check here (example field: expiresAt)
    if (invite.expiresAt && new Date(invite.expiresAt) < now) {
      console.error(`   ❌ Invite expired (${invite.expiresAt})`);
      Logger.info("verifyInviteToken", "Invite expired", {
        context: { inviteId: invite._id, token, ip: requesterIp },
        req
      });
      return res.status(410).json({ message: "This survey link has expired" });
    }
    console.log(`   ✅ Invite not expired`);

    // Update invite: mark opened + capture ip and userAgent (idempotent)
    console.log(`\n📝 [Step 3] Marking invite as opened...`);
    const update = {
      status: invite.status !== "opened" ? "opened" : invite.status,
      openedAt: invite.openedAt || new Date(),
      lastAccessIp: requesterIp,
      lastAccessUserAgent: userAgent,
      updatedAt: new Date()
    };

    await SurveyInvite.updateOne({ _id: invite._id }, { $set: update }).catch(err => {
      console.warn(`   ⚠️ Failed to update invite metadata: ${err.message}`);
      // non-fatal, log and continue — we still return the survey
      Logger.warn("verifyInviteToken: failed to update invite opened metadata", { inviteId: invite._id, error: err.message });
    });
    console.log(`   ✅ Invite status updated to: ${update.status}`);
    console.log(`   OpenedAt: ${update.openedAt}`);

    // Build safe survey object to return (avoid leaking tenant internal fields)
    console.log(`\n📤 [Step 4] Building response...`);
    const safeSurvey = {
      _id: survey._id,
      title: survey.title,
      description: survey.description,
      questions: survey.questions || [],
      settings: survey.settings || {},
      themeColor: survey.themeColor || null,
      thankYouPage: survey.thankYouPage || null,
      estimatedTime: survey.estimatedTime || null,
      isPasswordProtected: survey.settings?.isPasswordProtected || false
    };
    console.log(`   Questions count: ${safeSurvey.questions.length}`);

    Logger.info("verifyInviteToken", "Invite verified and survey returned", {
      context: { inviteId: invite._id, surveyId: survey._id, ip: requesterIp },
      req
    });

    console.log(`\n✅ [VerifyToken] SUCCESS`);
    console.log(`${'#'.repeat(60)}\n`);

    return res.status(200).json({
      success: true,
      inviteId: invite._id,
      survey: safeSurvey
    });

  } catch (err) {
    console.error(`\n❌ [VerifyToken] UNEXPECTED ERROR`);
    console.error(`   Error: ${err.message}`);
    console.error(`   Stack: ${err.stack}`);
    console.error(`${'#'.repeat(60)}\n`);
    Logger.error("verifyInviteToken", "Unexpected error", {
      context: { error: err.message, stack: err.stack },
      req
    });
    return next(err);
  }
};
