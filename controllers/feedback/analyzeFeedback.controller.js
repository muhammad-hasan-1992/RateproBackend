// controllers/feedback/analyzeFeedback.controller.js
const { analyzeSchema } = require("../../validators/feedbackValidator");
const { analyzeFeedbackLogic } = require("../../services/feedback/feedbackService");
const Logger = require("../../utils/logger");

/**
 * Analyze feedback responses using AI
 */
exports.analyzeFeedback = async (req, res) => {
    try {
        const { error, value } = analyzeSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ success: false, message: error.details[0].message });
        }

        const analyses = await analyzeFeedbackLogic(value, req.tenantId);

        res.status(200).json({
            success: true,
            message: "Feedback analysis completed successfully",
            analyses,
        });
    } catch (err) {
        Logger.error("analyzeFeedback", "Failed to analyze feedback", {
            error: err,
            context: { tenantId: req.tenantId },
            req
        });
        res.status(500).json({
            success: false,
            message: "Failed to analyze feedback",
            error: err.message,
        });
    }
};
