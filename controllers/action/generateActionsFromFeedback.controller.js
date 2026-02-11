// controllers/action/generateActionsFromFeedback.controller.js
// ============================================================================
// AI Action Generation — Routes through actionService.createAction
//
// ❌ NO direct Action.create() — all creation goes through the service layer.
// ✅ AI prompt requests structured Phase 1 fields
// ✅ Multi-feedback evidence aggregation (Gap 2 fix)
// ✅ Service handles Joi validation, tenant checks, assignment rules
// ============================================================================

const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const User = require("../../models/User");
const aiClient = require("../../utils/aiClient");
const { createAction } = require("../../services/action/actionService");
const { sendNotification } = require("../../utils/sendNotification");
const Logger = require("../../utils/logger");

/**
 * Generate actions from feedback using AI.
 * Routes ALL creation through actionService.createAction().
 */
exports.generateActionsFromFeedback = async (req, res, next) => {
    try {
        const { feedbackIds, options = {} } = req.body;
        if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) {
            return res.status(400).json({ success: false, message: "Feedback IDs array required" });
        }

        const tenantId = req.user.tenant;
        const userId = req.user._id;

        // ── Fetch all feedbacks (tenant-scoped) ─────────────────────
        const feedbacks = await FeedbackAnalysis.find({
            _id: { $in: feedbackIds },
            tenant: tenantId
        }).populate("survey", "title _id");

        if (feedbacks.length === 0) {
            return res.status(404).json({ success: false, message: "No feedback found" });
        }

        // ── Build feedback summary for AI prompt ────────────────────
        const feedbackSummary = feedbacks.map(f => ({
            id: f._id.toString(),
            sentiment: f.sentiment,
            category: f.categories?.[0] || "general",
            categories: f.categories || [],
            surveyTitle: f.survey?.title || "Unknown"
        }));

        // ── Enhanced AI prompt — requests structured Phase 1 fields ─
        const prompt = `Analyze these employee feedback items and create a compact JSON array of suggested actions.

For EACH action include:
- "title": short action title (max 80 chars)
- "description": detailed action description
- "priority": one of "high", "medium", "low", "long-term"
- "category": action category
- "team": which team should handle this
- "problemStatement": a clear problem statement derived from the feedback
- "rootCauseCategory": one of "compensation", "process", "communication", "management", "workload", "culture", "resources", "unknown"
- "rootCauseSummary": brief root cause explanation
- "priorityReason": why this priority level was chosen
- "urgencyReason": why this is urgent (if applicable, null otherwise)
- "feedbackIndices": array of 0-based indices of which feedbacks this action addresses

Feedback items:
${JSON.stringify(feedbackSummary, null, 2)}

Respond with ONLY a valid JSON array. No markdown, no explanation.`;

        let suggestedActions;
        try {
            const aiResponse = await aiClient.complete({ prompt, maxTokens: 1200 });

            // Try to parse AI response
            try {
                suggestedActions = JSON.parse(aiResponse.text);
            } catch (parseErr) {
                // Try extracting JSON from markdown code block
                const match = aiResponse.text?.match(/\[[\s\S]*\]/);
                if (match) {
                    try {
                        suggestedActions = JSON.parse(match[0]);
                    } catch {
                        suggestedActions = null;
                    }
                }
            }

            // ── Fallback: create actions for negative feedbacks ─────
            if (!Array.isArray(suggestedActions) || suggestedActions.length === 0) {
                suggestedActions = [];
                feedbacks.forEach((f, idx) => {
                    if (f.sentiment === "negative") {
                        suggestedActions.push({
                            title: `Investigate: ${(f.categories?.[0] || "Feedback Issue").substring(0, 60)}`,
                            description: `Investigate negative feedback: ${f.categories?.join(", ") || "Follow-up required"}`,
                            priority: "high",
                            team: "Customer Service",
                            category: "Customer Issue",
                            feedbackIndices: [idx]
                        });
                    }
                });
            }

            // ── Create actions via service layer ────────────────────
            const createdActions = [];

            for (const suggestion of suggestedActions) {
                // Determine which feedbacks this action covers
                const indices = Array.isArray(suggestion.feedbackIndices) && suggestion.feedbackIndices.length > 0
                    ? suggestion.feedbackIndices
                    : [0];  // Default to first feedback if AI doesn't specify

                // ─ Build multi-feedback evidence (Gap 2 fix) ────────
                const coveredFeedbacks = indices
                    .map(i => feedbacks[i])
                    .filter(Boolean);

                const primaryFeedback = coveredFeedbacks[0] || feedbacks[0];

                const evidence = {
                    responseCount: coveredFeedbacks.length,
                    respondentCount: coveredFeedbacks.length,
                    responseIds: coveredFeedbacks
                        .map(f => f.response)
                        .filter(Boolean),
                    commentExcerpts: coveredFeedbacks.map(f => ({
                        text: (f.categories?.join(", ") || "Feedback").substring(0, 500),
                        sentiment: f.sentiment || "neutral",
                        responseId: f.response || undefined
                    })),
                    confidenceScore: null
                };

                // ─ Build metadata ───────────────────────────────────
                const metadata = {
                    surveyId: primaryFeedback.survey?._id || primaryFeedback.survey || null,
                    responseId: primaryFeedback.response || null,
                    sentiment: primaryFeedback.sentiment || null,
                    confidence: null
                };

                // ─ Build service payload ────────────────────────────
                const serviceData = {
                    feedbackId: primaryFeedback._id.toString(),
                    title: suggestion.title || (suggestion.description || "").substring(0, 80),
                    description: suggestion.description || "AI-generated follow-up action",
                    priority: suggestion.priority || "medium",
                    team: suggestion.team || "General",
                    category: suggestion.category || "AI Generated",
                    source: "ai_generated",
                    tags: ["ai-generated", "feedback-analysis"],

                    // Phase 1 fields from AI
                    problemStatement: suggestion.problemStatement || null,
                    rootCause: {
                        category: suggestion.rootCauseCategory || "unknown",
                        summary: suggestion.rootCauseSummary || null
                    },
                    priorityReason: suggestion.priorityReason || null,
                    urgencyReason: suggestion.urgencyReason || null,
                    evidence,
                    metadata
                };

                try {
                    // ✅ ALL creation through service — validated, enriched, assigned
                    const action = await createAction({
                        data: serviceData,
                        tenantId,
                        userId,
                        options: { skipNotification: true } // Bulk: notify admins below instead
                    });
                    createdActions.push(action);
                } catch (createErr) {
                    Logger.error("generateActionsFromFeedback", "Failed to create action via service", {
                        error: createErr,
                        context: { suggestion: suggestion.title, tenantId }
                    });
                    // Continue with remaining suggestions
                }
            }

            // ── Notify all CompanyAdmins ────────────────────────────
            if (createdActions.length > 0) {
                try {
                    const companyAdmins = await User.find({
                        tenant: tenantId,
                        role: "companyAdmin",
                        isActive: true,
                        deleted: false
                    }).select("_id").lean();

                    const surveyTitle = feedbacks.find(f => f.survey?.title)?.survey?.title || null;

                    for (const admin of companyAdmins) {
                        await sendNotification({
                            userId: admin._id,
                            type: "action",
                            title: "AI-Generated Actions Created",
                            message: `${createdActions.length} new action(s) generated from feedback analysis${surveyTitle ? ` for survey: ${surveyTitle}` : ""}`,
                            data: {
                                actionCount: createdActions.length,
                                generatedBy: userId,
                                timestamp: new Date().toISOString()
                            },
                            actionUrl: "/app/actions"
                        });
                    }
                } catch (notifErr) {
                    Logger.error("generateActionsFromFeedback", "Failed to notify admins", {
                        error: notifErr,
                        context: { tenantId, actionCount: createdActions.length }
                    });
                }
            }

            res.status(200).json({
                success: true,
                message: `${createdActions.length} actions generated`,
                data: {
                    actions: createdActions,
                    feedbackProcessed: feedbacks.length
                }
            });

        } catch (aiError) {
            Logger.error("generateActionsFromFeedback", "AI error", {
                error: aiError,
                context: { userId },
                req
            });
            return res.status(500).json({
                success: false,
                message: "AI service error generating actions",
                error: aiError.message
            });
        }

    } catch (err) {
        Logger.error("generateActionsFromFeedback", "Unexpected error", {
            error: err,
            context: { userId: req.user?._id },
            req
        });
        res.status(500).json({
            success: false,
            message: "Error generating actions from feedback",
            error: err.message
        });
    }
};
