// services/responses/anonymousResponseService.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const { postResponseQueue } = require("../../queues/postResponse.queue");
const { onSurveyResponse } = require("../contact/contactSurveySync.service");
const Logger = require("../../utils/auditLog");
const geoip = require("geoip-lite");

/**
 * Extract metadata from user agent and IP address
 * @param {string} userAgent - User agent string
 * @param {string} ip - IP address for geolocation
 * @returns {Object} Metadata including device, browser, os, location
 */
function getRequestMetadata(userAgent, ip) {
    const ua = (userAgent || '').toLowerCase();

    // Parse device type
    let device = 'desktop';
    if (/mobile|android|iphone|ipod/i.test(ua)) {
        device = 'mobile';
    } else if (/ipad|tablet/i.test(ua)) {
        device = 'tablet';
    }

    // Parse browser
    let browser = 'unknown';
    if (ua.includes('edg')) browser = 'Edge';
    else if (ua.includes('chrome')) browser = 'Chrome';
    else if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('safari')) browser = 'Safari';

    // Parse OS
    let os = 'unknown';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('mac os') || ua.includes('macos')) os = 'macOS';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
    else if (ua.includes('linux')) os = 'Linux';

    // Get location from IP using geoip-lite
    let location = null;
    if (ip) {
        // Clean IP (remove ::ffff: prefix for IPv4-mapped IPv6)
        const cleanIp = ip.replace(/^::ffff:/, '');
        const geo = geoip.lookup(cleanIp);
        if (geo) {
            // Format: "City, Country" or just "Country" if no city
            location = geo.city
                ? `${geo.city}, ${geo.country}`
                : geo.country;
        }
    }

    return { device, browser, os, location, userAgent };
}

// Legacy alias for backward compatibility
function parseUserAgent(userAgent) {
    return getRequestMetadata(userAgent, null);
}

exports.handleAnonymousResponse = async ({ surveyId, payload, ip, userAgent }) => {  // ADD userAgent
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`📨 [AnonymousResponse] NEW SUBMISSION`);
    console.log(`   Survey ID: ${surveyId}`);
    console.log(`   IP: ${ip}`);
    console.log(`   User-Agent: ${userAgent?.substring(0, 50)}...`);  // NEW: Log user agent
    console.log(`   Answers count: ${payload?.answers?.length || 0}`);
    console.log(`   Rating: ${payload?.rating || 'N/A'}`);
    console.log(`   Score: ${payload?.score || 'N/A'}`);
    console.log(`   Email: ${payload?.email || 'N/A'}`);
    console.log(`${'*'.repeat(60)}`);

    // Parse metadata from user agent and IP
    const metadata = getRequestMetadata(userAgent, ip);
    console.log(`\n📱 [Metadata] Parsed:`);
    console.log(`   Device: ${metadata.device}`);
    console.log(`   Browser: ${metadata.browser}`);
    console.log(`   OS: ${metadata.os}`);
    console.log(`   Location: ${metadata.location || 'Unknown'}`);

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

    // NEW: Debug question IDs
    console.log(`\n📋 [Debug] Survey Question IDs:`);
    survey.questions?.forEach((q, i) => {
        console.log(`   Q${i + 1}: id="${q.id}", _id="${q._id}", type="${q.type}"`);
    });

    // NEW: Debug answer questionIds
    console.log(`\n📋 [Debug] Payload Answer QuestionIds:`);
    payload.answers?.forEach((a, i) => {
        console.log(`   A${i + 1}: questionId="${a.questionId}", answer="${String(a.answer).substring(0, 30)}..."`);
    });

    console.log(`\n💾 [Step 2] Creating response record...`);
    const responseData = {
        survey: survey._id,
        tenant: survey.tenant,
        answers: payload.answers,
        review: payload.review,
        rating: payload.rating,
        score: payload.score,
        isAnonymous: true,
        ip,
        metadata,  // NEW: Now populated!
        completionTime: payload.completionTime || null,
        startedAt: payload.startedAt || null,
        createdBy: null,
        user: null,
    };

    console.log(`\n📋 [Debug] Response Data to Save:`);
    console.log(`   Metadata: ${JSON.stringify(responseData.metadata)}`);

    const response = await SurveyResponse.create(responseData);
    console.log(`   ✅ Response created: ${response._id}`);
    console.log(`   Saved metadata: ${JSON.stringify(response.metadata)}`);

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

exports.submitAnonymousSurvey = async (surveyId, answers, req, reviewData = {}) => {
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`📨 [AnonymousResponse] NEW SUBMISSION`);
    console.log(`   Survey ID: ${surveyId}`);
    console.log(`   IP: ${req.ip}`);
    console.log(`   Answers count: ${answers?.length || 0}`);
    console.log(`   Rating: ${reviewData.rating || 'N/A'}`);
    console.log(`   Score: ${reviewData.score || 'N/A'}`);
    console.log(`   Email: ${req.body.email || 'N/A'}`);
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
    // Format answers for storage
    const formattedAnswers = answers.map((answer) => ({
        question: answer.question,
        value: answer.value,
    }));

    // Extract metadata from request including IP geolocation
    const userAgent = req.headers['user-agent'] || '';
    const metadata = getRequestMetadata(userAgent, req.ip);

    const responseData = {
        survey: survey._id,
        tenant: survey.tenant,
        answers: formattedAnswers,
        review: reviewData.review,
        rating: reviewData.rating,
        score: reviewData.score,
        isAnonymous: true,
        ip: req.ip,
        metadata,  // NEW: Add metadata
        completionTime: reviewData.completionTime || null,  // NEW: Expect from frontend
        startedAt: reviewData.startedAt || null  // NEW: Expect from frontend
    };

    const response = await SurveyResponse.create(responseData);
    console.log(`   ✅ Response created: ${response._id}`);

    // ✅ NEW: Sync to Contact.surveyStats if email is provided
    // This enables behavior-based segmentation even for anonymous responses
    if (req.body.email) {
        console.log(`\n👤 [Step 2.5] Syncing to contact stats...`);
        try {
            await onSurveyResponse({
                tenantId: survey.tenant,
                email: req.body.email,
                npsScore: reviewData.score ?? null,
                rating: reviewData.rating ?? null,
                responseDate: new Date(),
            });
            console.log(`   ✅ Contact stats synced for: ${req.body.email}`);
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
            hasEmail: !!req.body.email
        },
        ip: req.ip
    });

    console.log(`\n✅ [AnonymousResponse] COMPLETE`);
    console.log(`${'*'.repeat(60)}\n`);

    return response;
};