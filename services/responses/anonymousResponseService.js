// services/responses/anonymousResponseService.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const { postResponseQueue } = require("../../queues/postResponse.queue");
const { onSurveyResponse } = require("../contact/contactSurveySync.service");
const Logger = require("../../utils/auditLog");

exports.handleAnonymousResponse = async ({ surveyId, payload, ip }) => {
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`📨 [AnonymousResponse] NEW SUBMISSION`);
    console.log(`   Survey ID: ${surveyId}`);
    console.log(`   IP: ${ip}`);
    console.log(`   Answers count: ${payload?.answers?.length || 0}`);
    console.log(`   Rating: ${payload?.rating || 'N/A'}`);
    console.log(`   Score: ${payload?.score || 'N/A'}`);
    console.log(`   Email: ${payload?.email || 'N/A'}`);
    console.log(`${'*'.repeat(60)}`);

    console.log(`\n🔍 [Step 1] Looking up survey...`);
    const survey = await Survey.findOne({
        _id: surveyId,
        status: "active",
        deleted: false,
    });

    if (!survey) {
        console.error(`   ❌ Survey not found or inactive: ${surveyId}`);
        throw { status: 404, message: "Survey not found or inactive" };
    }
    console.log(`   ✅ Survey found: "${survey.title}"`);
    console.log(`   Tenant: ${survey.tenant}`);

    console.log(`\n💾 [Step 2] Creating response record...`);
    const response = await SurveyResponse.create({
        survey: survey._id,
        tenant: survey.tenant,
        answers: payload.answers,
        review: payload.review,
        rating: payload.rating,
        score: payload.score,
        isAnonymous: true,
        ip,
        createdBy: null,
        user: null,
    });
    console.log(`   ✅ Response created: ${response._id}`);

    // ✅ NEW: Sync to Contact.surveyStats if email is provided
    // This enables behavior-based segmentation even for anonymous responses
    if (payload.email) {
        console.log(`\n👤 [Step 2.5] Syncing to contact stats...`);
        try {
            await onSurveyResponse({
                tenantId: survey.tenant,
                email: payload.email,
                npsScore: payload.score ?? null,
                rating: payload.rating ?? null,
                responseDate: new Date(),
            });
            console.log(`   ✅ Contact stats synced for: ${payload.email}`);
        } catch (syncErr) {
            // Non-blocking - don't fail the response submission
            console.warn(`   ⚠️ Contact sync failed (non-blocking): ${syncErr.message}`);
        }
    } else {
        console.log(`\n👤 [Step 2.5] No email provided - skipping contact sync`);
    }

    // Queue post-processing (analytics, AI analysis, actions)
    console.log(`\n📤 [Step 3] Queueing post-processing...`);
    await postResponseQueue.add("process-response", {
        response,
        survey,
        tenantId: survey.tenant
    });
    console.log(`   ✅ Post-processing queued`);

    Logger.info("surveyResponse", "Anonymous response submitted", {
        context: {
            surveyId: survey._id,
            responseId: response._id,
            hasEmail: !!payload.email
        },
        ip
    });

    console.log(`\n✅ [AnonymousResponse] COMPLETE`);
    console.log(`${'*'.repeat(60)}\n`);

    return response;
};