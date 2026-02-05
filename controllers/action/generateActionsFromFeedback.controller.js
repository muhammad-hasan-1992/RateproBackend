// controllers/action/generateActionsFromFeedback.controller.js
const Action = require("../../models/Action");
const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const aiClient = require("../../utils/aiClient");
const { applyAssignmentRules } = require("../../services/action/assignmentService");
const { pushAssignmentHistory } = require("../../services/action/actionService");
const Logger = require("../../utils/logger");

/**
 * Generate actions from feedback using AI
 */
exports.generateActionsFromFeedback = async (req, res, next) => {
    try {
        const { feedbackIds, options = {} } = req.body;
        if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) {
            return res.status(400).json({ success: false, message: "Feedback IDs array required" });
        }

        const feedbacks = await FeedbackAnalysis.find({ _id: { $in: feedbackIds }, tenant: req.user.tenant }).populate("survey", "title");
        if (feedbacks.length === 0) {
            return res.status(404).json({ success: false, message: "No feedback found" });
        }

        const feedbackSummary = feedbacks.map(f => ({
            id: f._id,
            sentiment: f.sentiment,
            category: f.category,
            summary: f.summary,
            survey: f.survey?.title
        }));

        const prompt = `Create a compact JSON array of suggested actions for these feedbacks. Each item: { description, priority (high|medium|low|long-term), team, category }. Feedback: ${JSON.stringify(feedbackSummary)}`;

        let suggestedActions;
        try {
            const aiResponse = await aiClient.complete({ prompt, maxTokens: 800 });
            try {
                suggestedActions = JSON.parse(aiResponse.text);
            } catch (e) {
                suggestedActions = null;
            }

            if (!Array.isArray(suggestedActions)) {
                // Fallback for negative sentiments
                suggestedActions = [];
                for (const f of feedbacks) {
                    if (f.sentiment === "negative") {
                        suggestedActions.push({
                            description: `Investigate: ${f.summary?.substring(0, 200) || "Follow-up required"}`,
                            priority: "high",
                            team: "Customer Service",
                            category: "Customer Issue",
                            feedbackId: f._id
                        });
                    }
                }
            }

            const createdActions = [];
            for (const a of suggestedActions) {
                const payload = {
                    title: a.title || (a.description || "").substring(0, 80),
                    feedback: a.feedbackId || feedbacks[0]._id,
                    description: a.description,
                    priority: a.priority || "medium",
                    team: a.team || "General",
                    category: a.category || "AI Generated",
                    tenant: req.user.tenant,
                    createdBy: req.user._id,
                    source: "ai_generated",
                    tags: ["ai-generated", "feedback-analysis"],
                    autoAssigned: false
                };

                // Apply assignment rules
                const ruleResult = await applyAssignmentRules(payload, req.user.tenant);
                if (ruleResult) {
                    if (ruleResult.assignedTo) payload.assignedTo = ruleResult.assignedTo;
                    if (ruleResult.assignedToTeam) payload.assignedToTeam = ruleResult.assignedToTeam;
                    if (ruleResult.priority) payload.priority = ruleResult.priority;
                    payload.autoAssigned = true;
                }

                const action = await Action.create(payload);

                if (payload.autoAssigned && action.assignedTo) {
                    pushAssignmentHistory(action, {
                        from: null,
                        to: action.assignedTo,
                        toTeam: action.assignedToTeam,
                        byUserId: req.user._id,
                        auto: true,
                        note: "Auto-assigned by rules on AI generation"
                    });
                    await action.save();
                }

                createdActions.push(action);
            }

            // Notify all CompanyAdmins of the tenant about new AI-generated actions
            if (createdActions.length > 0) {
                const User = require("../../models/User");
                const { sendNotification } = require("../../utils/sendNotification");

                const companyAdmins = await User.find({
                    tenant: req.user.tenant,
                    role: "companyAdmin",
                    isActive: true,
                    deleted: false
                }).select("_id").lean();

                // Get survey reference from first action if available
                const surveyId = createdActions[0]?.metadata?.surveyId;
                const surveyInfo = surveyId ? feedbacks.find(f => f.survey)?.survey?.title : null;

                for (const admin of companyAdmins) {
                    await sendNotification({
                        userId: admin._id,
                        type: "action",
                        title: "AI-Generated Actions Created",
                        message: `${createdActions.length} new action(s) generated from feedback analysis${surveyInfo ? ` for survey: ${surveyInfo}` : ""}`,
                        data: {
                            actionCount: createdActions.length,
                            surveyId: surveyId || null,
                            generatedBy: req.user._id,
                            timestamp: new Date().toISOString()
                        },
                        actionUrl: "/app/actions"
                    });
                }
            }

            res.status(200).json({
                success: true,
                message: `${createdActions.length} actions generated`,
                data: { actions: createdActions, feedbackProcessed: feedbacks.length }
            });

        } catch (aiError) {
            Logger.error("generateActionsFromFeedback", "AI error", {
                error: aiError,
                context: { userId: req.user?._id },
                req
            });
            return res.status(500).json({ success: false, message: "AI service error generating actions", error: aiError.message });
        }

    } catch (err) {
        Logger.error("generateActionsFromFeedback", "Unexpected error", {
            error: err,
            context: { userId: req.user?._id },
            req
        });
        res.status(500).json({ success: false, message: "Error generating actions from feedback", error: err.message });
    }
};
