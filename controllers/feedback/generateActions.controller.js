// controllers/feedback/generateActions.controller.js
const FeedbackAnalysis = require("../../models/FeedbackAnalysis");
const Action = require("../../models/Action");
const { generateActionsSchema } = require("../../validators/feedbackValidator");
const Logger = require("../../utils/logger");

/**
 * Generate actions from feedback analysis
 */
exports.generateActions = async (req, res) => {
    try {
        const { error, value } = generateActionsSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const feedbacks =
            value.feedbackIds && value.feedbackIds.length
                ? await FeedbackAnalysis.find({ _id: { $in: value.feedbackIds }, tenant: req.tenantId }).populate('response')
                : await FeedbackAnalysis.find({ tenant: req.tenantId, createdAt: { $gte: new Date(0) } }).populate('response');

        const created = [];

        for (const fb of feedbacks) {
            let priority = "medium";
            if (fb.sentiment === "negative") priority = "high";
            if (fb.categories && fb.categories.includes("safety")) priority = "high";

            const { createAction } = require("../../services/action/actionService");

            const action = await createAction({
                data: {
                    title: `Follow up: ${fb.categories?.join(", ") || "General feedback"}`,
                    description: `Follow up on: ${fb.categories?.join(", ") || "General feedback"}. Response excerpt: ${fb.response?.review?.slice(0, 200) || ""}`,
                    priority,
                    feedbackId: fb._id,
                    team: fb.categories?.[0] || "operations",
                    source: "ai_generated",
                    problemStatement: fb.response?.review?.slice(0, 2000) || `Follow up on: ${fb.categories?.join(", ") || "General feedback"}`,
                    metadata: {
                        responseId: fb.response?._id,
                        sentiment: fb.sentiment
                    }
                },
                tenantId: req.tenantId,
                userId: req.user?._id || null,
                options: { skipNotification: true }
            });

            created.push(action);
        }

        res.status(201).json({
            success: true,
            message: "Actions generated successfully",
            actions: created,
        });
    } catch (err) {
        Logger.error("generateActions", "Failed to generate actions", {
            error: err,
            context: { tenantId: req.tenantId },
            req
        });
        res.status(500).json({
            success: false,
            message: "Failed to generate actions",
            error: err.message,
        });
    }
};
