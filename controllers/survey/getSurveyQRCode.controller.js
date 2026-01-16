// controllers/survey/getSurveyQRCode.controller.js
const QRCode = require("qrcode");
const Logger = require("../../utils/logger");

/**
 * Generate QR code for a survey
 */
exports.getSurveyQRCode = async (req, res, next) => {
    try {
        const { id } = req.params;
        const url = `${process.env.FRONTEND_URL}/take-survey/${id}`;
        const qr = await QRCode.toDataURL(url);

        res.status(200).json({ qr });
    } catch (err) {
        Logger.error("getSurveyQRCode", "Error generating survey QR Code", {
            error: err,
            context: { surveyId: req.params?.id },
            req,
        });
        next(err);
    }
};
