// /services/responses/submitResponseService.js
const SurveyInvite = require("../../models/SurveyInvite");
const SurveyResponse = require("../../models/SurveyResponse");
const { postResponseQueue } = require("../../queues/postResponse.queue");
const { onSurveyResponse } = require("../contact/contactSurveySync.service");
const Logger = require("../../utils/auditLog");

exports.submitSurveyResponseService = async ({
  token,
  payload,
  ip,
  user
}) => {
  console.log(`\n${'*'.repeat(60)}`);
  console.log(`📨 [InvitedResponse] NEW SUBMISSION`);
  console.log(`   Token: ${token?.substring(0, 8)}...`);
  console.log(`   IP: ${ip}`);
  console.log(`   User: ${user?._id || 'N/A'}`);
  console.log(`   isAnonymous: ${payload?.isAnonymous || false}`);
  console.log(`   Answers count: ${payload?.answers?.length || 0}`);
  console.log(`${'*'.repeat(60)}`);

  // 1️⃣ Validate invite
  console.log(`\n🔍 [Step 1] Validating invite token...`);
  const invite = await SurveyInvite.findOne({ token }).populate("survey");

  if (!invite) {
    console.error(`   ❌ Invalid invite token`);
    throw new Error("INVALID_INVITE_TOKEN");
  }
  console.log(`   ✅ Invite found: ${invite._id}`);
  console.log(`   Survey: "${invite.survey?.title}"`);
  console.log(`   Status: ${invite.status}`);

  if (invite.status === "responded") {
    console.error(`   ❌ Survey already submitted`);
    throw new Error("SURVEY_ALREADY_SUBMITTED");
  }

  // 2️⃣ Save response
  console.log(`\n💾 [Step 2] Creating response record...`);
  const response = await SurveyResponse.create({
    survey: invite.survey._id,
    tenant: invite.tenant,
    user: payload.isAnonymous ? null : user?._id,
    createdBy: user?._id,
    answers: payload.answers,
    review: payload.review,
    rating: payload.rating,
    score: payload.score,
    isAnonymous: payload.isAnonymous,
    ip
  });
  console.log(`   ✅ Response created: ${response._id}`);

  // 3️⃣ Update invite
  console.log(`\n📝 [Step 3] Updating invite status...`);
  invite.status = "responded";
  invite.respondedAt = new Date();
  await invite.save();
  console.log(`   ✅ Invite marked as responded`);

  // 4️⃣ 🔥 NEW: Sync to Contact.surveyStats
  if (invite.contact?.email) {
    console.log(`\n👤 [Step 4] Syncing to contact stats...`);
    console.log(`   Contact email: ${invite.contact.email}`);
    await onSurveyResponse({
      tenantId: invite.tenant,
      email: invite.contact.email,
      npsScore: payload.score,    // NPS score (0-10)
      rating: payload.rating,      // Rating (1-5)
      responseDate: new Date(),
    });
    console.log(`   ✅ Contact stats synced`);
  } else {
    console.log(`\nℹ️ [Step 4] No contact email, skipping sync`);
  }

  // 5️⃣ Post-processing (actions, AI analysis, etc.) - queued for async processing
  console.log(`\n📤 [Step 5] Queueing post-processing...`);
  await postResponseQueue.add("process-response", {
    response,
    survey: invite.survey,
    tenantId: invite.tenant
  });
  console.log(`   ✅ Post-processing queued`);

  Logger.info("surveyResponse", "Survey response submitted", {
    context: {
      surveyId: invite.survey._id,
      responseId: response._id,
      inviteId: invite._id,
      contactEmail: invite.contact?.email,
    },
    ip
  });

  console.log(`\n✅ [InvitedResponse] COMPLETE`);
  console.log(`${'*'.repeat(60)}\n`);

  return response;
};