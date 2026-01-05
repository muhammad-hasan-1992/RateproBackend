// /services/responses/submitResponseService.js
const SurveyInvite = require("../../models/SurveyInvite");
const SurveyResponse = require("../../models/SurveyResponse");
const { postResponseQueue } = require("../../queues/postResponse.queue");
const { onSurveyResponse } = require("../contact/contactSurveySync.service");
const Logger = require("../../utils/auditLog");

/**
 * Extract NPS and rating from answers based on question types
 */
function extractMetricsFromAnswers(answers, survey) {
  let npsScore = null;
  let rating = null;
  
  const questions = survey?.questions || [];
  
  // Build a map of questionId -> question for quick lookup
  const questionMap = new Map();
  questions.forEach(q => {
    const qId = q._id?.toString() || q.id;
    if (qId) {
      questionMap.set(qId, q);
    }
  });
  
  // Iterate through answers and extract metrics based on question type
  for (const ans of answers) {
    const questionId = ans.questionId?.toString();
    const question = questionMap.get(questionId);
    
    if (!question) continue;
    
    const qType = question.type?.toLowerCase();
    const ansValue = parseAnswerValue(ans.answer);
    
    if (ansValue === null) continue;
    
    switch (qType) {
      case 'nps':
        if (npsScore === null) {
          npsScore = Math.min(10, Math.max(0, ansValue));
        }
        break;
        
      case 'rating':
      case 'scale':
      case 'likert':
        if (rating === null) {
          rating = ansValue;
        }
        break;
    }
  }
  
  return { npsScore, rating };
}

/**
 * Parse answer value to a number
 */
function parseAnswerValue(answer) {
  if (answer === null || answer === undefined) return null;
  
  if (typeof answer === 'number') return answer;
  
  if (typeof answer === 'string') {
    const trimmed = answer.trim();
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed)) return parsed;
    
    // NPS text mappings
    const npsTextMap = {
      'not at all likely': 0, 'not likely': 2, 'unlikely': 3,
      'somewhat unlikely': 4, 'neutral': 5, 'somewhat likely': 6,
      'likely': 7, 'very likely': 9, 'extremely likely': 10
    };
    
    const lowerAnswer = trimmed.toLowerCase();
    if (npsTextMap[lowerAnswer] !== undefined) return npsTextMap[lowerAnswer];
    
    // Rating text mappings
    const ratingTextMap = {
      'very poor': 1, 'poor': 2, 'average': 3, 'fair': 3,
      'good': 4, 'very good': 5, 'excellent': 5
    };
    
    if (ratingTextMap[lowerAnswer] !== undefined) return ratingTextMap[lowerAnswer];
  }
  
  return null;
}

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
  console.log(`   isAnonymous: ${payload?.isAnonymous || false}`);
  console.log(`   Answers count: ${payload?.answers?.length || 0}`);
  console.log(`${'*'.repeat(60)}`);

  // 1️⃣ Validate invite
  console.log(`\n🔍 [Step 1] Validating invite token...`);
  const invite = await SurveyInvite.findOne({ token })
    .populate("survey")
    .populate("contact", "_id email name"); // 🔥 Populate contact

  if (!invite) {
    console.error(`   ❌ Invalid invite token`);
    throw new Error("INVALID_INVITE_TOKEN");
  }
  console.log(`   ✅ Invite found: ${invite._id}`);
  console.log(`   Survey: "${invite.survey?.title}"`);
  console.log(`   Status: ${invite.status}`);
  
  // 🔥 Get Contact info
  const contactId = invite.contact?._id;
  const contactEmail = invite.contact?.email;
  const contactName = invite.contact?.name;
  console.log(`   Contact: ${contactName || contactEmail || 'Anonymous'} (${contactId || 'N/A'})`);

  if (invite.status === "responded") {
    console.error(`   ❌ Survey already submitted`);
    throw new Error("SURVEY_ALREADY_SUBMITTED");
  }

  // After invite validation, update the initial log with contact info
  console.log(`   📇 Respondent: ${invite.contact?.email || 'Anonymous'}`);

  // 🔥 Extract NPS and rating from answers if not provided
  let { rating, score } = payload;
  
  console.log(`\n📊 [Step 1.5] Extracting metrics from answers...`);
  console.log(`   Payload rating: ${rating}`);
  console.log(`   Payload score: ${score}`);
  console.log(`   Survey questions count: ${invite.survey?.questions?.length || 0}`);
  
  // Debug: Log question types
  if (invite.survey?.questions) {
    invite.survey.questions.forEach((q, i) => {
      console.log(`   Q${i+1}: type="${q.type}", id="${q._id || q.id}"`);
    });
  }
  
  // Debug: Log answers
  if (payload.answers) {
    payload.answers.forEach((a, i) => {
      console.log(`   A${i+1}: questionId="${a.questionId}", answer="${String(a.answer).substring(0, 30)}..."`);
    });
  }
  
  if (rating === undefined || score === undefined) {
    const extractedMetrics = extractMetricsFromAnswers(payload.answers || [], invite.survey);
    console.log(`   Extracted metrics:`, JSON.stringify(extractedMetrics));
    
    if (score === undefined && extractedMetrics.npsScore !== null) {
      score = extractedMetrics.npsScore;
      console.log(`   ✅ Using extracted NPS score: ${score}`);
    }
    
    if (rating === undefined && extractedMetrics.rating !== null) {
      rating = extractedMetrics.rating;
      console.log(`   ✅ Using extracted rating: ${rating}`);
    }
    
    if (score === undefined && rating === undefined) {
      console.log(`   ℹ️ No quantitative metrics found in answers`);
    }
  }

  // 2️⃣ Save response
  console.log(`\n💾 [Step 2] Creating response record...`);
  const response = await SurveyResponse.create({
    survey: invite.survey._id,
    tenant: invite.tenant,
    // 🔥 Link to contact for non-anonymous invited responses
    contact: payload.isAnonymous ? null : contactId,
    user: user?._id || null,
    createdBy: user?._id,
    answers: payload.answers,
    review: payload.review,
    rating: rating,
    score: score,
    isAnonymous: payload.isAnonymous,
    ip
  });
  console.log(`   ✅ Response created: ${response._id}`);
  if (rating !== undefined) console.log(`   Rating saved: ${rating}`);
  if (score !== undefined) console.log(`   NPS Score saved: ${score}`);
  if (contactId && !payload.isAnonymous) {
    console.log(`   📇 Linked to Contact: ${contactName || contactEmail} (${contactId})`);
  }

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
      npsScore: score,        // NPS score (0-10)
      rating: rating,         // Rating (1-5)
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
      npsScore: score,
      rating: rating
    },
    ip
  });

  console.log(`\n✅ [InvitedResponse] COMPLETE`);
  console.log(`${'*'.repeat(60)}\n`);

  return response;
};