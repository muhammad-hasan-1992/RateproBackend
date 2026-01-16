// controllers/survey/verifySurveyPassword.controller.js
const Survey = require("../../models/Survey");
const Logger = require("../../utils/logger");
const bcrypt = require("bcryptjs");

/**
 * Verify password for protected surveys
 */
exports.verifySurveyPassword = async (req, res, next) => {
    try {
        const { surveyId, password } = req.body;

        const survey = await Survey.findById(surveyId);

        if (!survey || survey.deleted || survey.status !== "active") {
            return res.status(404).json({ message: "Survey not found" });
        }

        if (!survey.settings?.isPasswordProtected) {
            return res.status(400).json({ message: "Survey is not password protected" });
        }

        const match = await bcrypt.compare(password, survey.settings.password || "");
        if (!match) {
            return res.status(401).json({ message: "Invalid password" });
        }

        res.status(200).json({ message: "Password verified", surveyId: survey._id });
    } catch (err) {
        Logger.error("verifySurveyPassword", "Error verifying survey password", {
            error: err,
            context: { surveyId: req.body?.surveyId },
            req,
        });
        next(err);
    }
};
