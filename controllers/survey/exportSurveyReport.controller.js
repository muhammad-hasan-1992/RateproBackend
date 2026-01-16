// controllers/survey/exportSurveyReport.controller.js
const Survey = require("../../models/Survey");
const SurveyResponse = require("../../models/SurveyResponse");
const Logger = require("../../utils/logger");
const PDFDocument = require("pdfkit");
const fs = require("fs");

/**
 * Export survey report as PDF
 */
exports.exportSurveyReport = async (req, res, next) => {
    try {
        const survey = await Survey.findById({
            _id: req.params.id,
            tenant: req.user.tenant,
        });

        if (!survey) {
            return res.status(404).json({ message: "Survey not found" });
        }

        const responses = await SurveyResponse.find({ survey: survey._id });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=survey-${survey._id}.pdf`);

        const doc = new PDFDocument();
        const filePath = `./uploads/survey-${survey._id}-${Date.now()}.pdf`;
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.fontSize(20).text("Survey Report", { align: "center" });
        doc.moveDown();
        doc.text(`Title: ${survey.title}`);
        doc.text(`Category: ${survey.category}`);
        doc.text(`Created: ${survey.createdAt}`);
        doc.text(`Total Responses: ${responses.length}`);
        doc.text(`Average Score: ${survey.averageScore}`);
        doc.text(`Average Rating: ${survey.averageRating}`);
        doc.moveDown();

        doc.fontSize(16).text("Recent Reviews:");
        responses.slice(-5).forEach((r, i) => {
            doc.moveDown(0.5);
            doc.text(`${i + 1}. Rating: ${r.rating} | Score: ${r.score}`);
            doc.text(`Review: ${r.review}`);
        });

        doc.end();

        stream.on("finish", async () => {
            res.download(filePath, `survey-${survey._id}.pdf`, () => {
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error("Failed to cleanup temp file:", e);
                }
            });
        });
    } catch (err) {
        Logger.error("exportSurveyReport", "Error exporting survey report", {
            error: err,
            context: { surveyId: req.params?.id, tenantId: req.user?.tenant },
            req,
        });
        next(err);
    }
};
