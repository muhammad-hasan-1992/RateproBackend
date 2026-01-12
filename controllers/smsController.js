// controllers/smsController.js
const { sendSMS } = require("../utils/sendSMS");
const Logger = require("../utils/logger");

// POST: Send SMS
exports.sendSMSHandler = async (req, res, next) => {
  try {
    const { to, body } = req.body;

    // --- Validate input ---
    if (!to || !body) {
      Logger.warn("sendSMSHandler", "Missing required fields", {
        context: {
          receivedBody: req.body,
          performedBy: req.user?._id
        },
        req
      });
      return res.status(400).json({ message: "Recipient number and message body are required" });
    }
    // --- Send SMS ---
    const result = await sendSMS({ to, body });

    // Logger.info("sendSMSHandler", "SMS sent successfully", {
    //   context: {
    //     to,
    //     messageLength: body.length,
    //     performedBy: req.user?._id,
    //     providerResponse: result
    //   },
    //   req
    // });
    return res.status(200).json({ message: "SMS sent successfully" });
  } catch (err) {
    Logger.error("sendSMSHandler", "Error sending SMS", {
      error: err,
      context: {
        performedBy: req.user?._id,
        tenantId: req.tenantId
      },
      req
    });
    next(err);
  }
};