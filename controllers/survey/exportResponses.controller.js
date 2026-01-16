// controllers/survey/exportResponses.controller.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const Logger = require("../../utils/logger");
const { Parser } = require("json2csv");

/**
 * Export survey responses as CSV
 */
exports.exportResponses = async (req, res, next) => {
    try {
        const survey = await Survey.findById(req.params.id);
        if (!survey) {
            return res.status(404).json({ message: "Survey not found" });
        }

        const responses = await SurveyResponse.find({ survey: survey._id });
        const fields = ["user", "score", "rating", "review", "createdAt"];
        const parser = new Parser({ fields });
        const csv = parser.parse(responses);

        res.header("Content-Type", "text/csv");
        res.attachment(`survey-${survey._id}-responses.csv`);
        res.send(csv);
    } catch (err) {
        Logger.error("exportResponses", "Error exporting survey responses", {
            error: err,
            context: { surveyId: req.params?.id, tenantId: req.user?.tenant },
            req,
        });
        next(err);
    }
};
