// services/feedback/feedbackService.js
const SurveyResponse = require("../../models/SurveyResponse");
const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const aiClient = require("../../utils/aiClient");
const Logger = require("../../utils/logger");

/**
 * Naive sentiment analysis fallback
 */
function naiveSentiment(text) {
    const lower = (text || "").toLowerCase();
    const negative = /(bad|poor|terrible|awful|disappoint|angry|hate|dissatisfied)/.test(lower);
    const positive = /(good|great|excellent|love|awesome|satisfied|happy|very awesome)/.test(lower);

    if (negative && positive) return "mixed";
    if (negative) return "negative";
    if (positive) return "positive";
    return "neutral";
}

/**
 * Analyze feedback responses - core business logic
 */
async function analyzeFeedbackLogic(options, tenantId) {
    const { responseIds, runAllUnanalyzed } = options;
    let responses = [];

    if (runAllUnanalyzed) {
        responses = await SurveyResponse.find({ tenant: tenantId }).lean();
    } else if (responseIds?.length) {
        responses = await SurveyResponse.find({ _id: { $in: responseIds }, tenant: tenantId }).lean();
    } else {
        throw new Error("Provide responseIds or set runAllUnanalyzed=true");
    }

    const analyses = [];

    for (const resp of responses) {
        const existing = await FeedbackAnalysis.findOne({ response: resp._id });
        if (existing) {
            analyses.push({ responseId: resp._id, status: "skipped", reason: "already analyzed" });
            continue;
        }

        const text = resp.review || (resp.answers || []).map(a => a.answer).join(" ");
        const prompt = `Analyze sentiment... Feedback: ${text}`;

        let aiResult;
        try {
            aiResult = await aiClient.complete({ prompt, maxTokens: 200 });
        } catch (err) {
            console.error("AI Error:", err.message);
            aiResult = { text: null };
        }

        const aiText = aiResult?.text || aiResult?.choices?.[0]?.message?.content || "";
        let sentiment = "neutral";
        let categories = [];

        try {
            if (aiText) {
                const parsed = JSON.parse(aiText);
                sentiment = parsed.sentiment || sentiment;
                categories = parsed.categories || [];
            } else {
                sentiment = naiveSentiment(text);
            }
        } catch {
            sentiment = naiveSentiment(text);
        }

        const fa = await FeedbackAnalysis.create({
            response: resp._id,
            sentiment,
            categories,
            tenant: tenantId,
        });

        analyses.push({ responseId: resp._id, status: "analyzed", analysis: fa });
    }

    return analyses;
}

module.exports = {
    naiveSentiment,
    analyzeFeedbackLogic
};
