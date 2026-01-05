// services/responses/anonymousResponseService.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const { postResponseQueue } = require("../../queues/postResponse.queue");
const Logger = require("../../utils/auditLog");

exports.handleAnonymousResponse = async ({ surveyId, payload, ip }) => {
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`📨 [AnonymousResponse] NEW SUBMISSION`);
    console.log(`   Survey ID: ${surveyId}`);
    console.log(`   IP: ${ip}`);
    console.log(`   Answers count: ${payload?.answers?.length || 0}`);
    console.log(`   Rating: ${payload?.rating || 'N/A'}`);
    console.log(`   Score: ${payload?.score || 'N/A'}`);
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
        },
        ip
    });

    console.log(`\n✅ [AnonymousResponse] COMPLETE`);
    console.log(`${'*'.repeat(60)}\n`);

    return response;
};