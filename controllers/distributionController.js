// controllers/distributionController.js
const Survey = require('../models/Survey');
const WhatsAppSetting = require('../models/WhatsAppSetting');
const sendWhatsApp = require('../utils/sendWhatsApp');
const Joi = require('joi');
const Tenant = require('../models/Tenant');
const Logger = require("../utils/logger");

const sendSchema = Joi.object({
  surveyId: Joi.string().hex().length(24).required(),
  recipients: Joi.array().items(Joi.string()).optional(), // list of phone numbers with +92..
  messageTemplate: Joi.string().optional().allow(''),
  viaTenantDefault: Joi.boolean().optional().default(true), // use tenant settings if recipients not provided
});

// Send survey via WhatsApp
exports.sendSurveyWhatsApp = async (req, res, next) => {
  try {
    const { error, value } = sendSchema.validate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const { surveyId, recipients: providedRecipients, messageTemplate, viaTenantDefault } = value;

    const survey = await Survey.findById(surveyId);
    if (!survey || survey.deleted) return res.status(404).json({ message: 'Survey not found' });

    const link = `${process.env.FRONTEND_URL}/take-survey/${survey._id}`;
    const defaultMsg = messageTemplate || `Please take this quick survey: ${link}`;

    let toList = providedRecipients || [];
    if ((!toList || toList.length === 0) && viaTenantDefault) {
      const tenant = await Tenant.findById(req.tenantId).select("contacts");
      if (tenant?.contacts?.length > 0) {
        toList = tenant.contacts.map(c => c.phone);
      }
    }

    if (!toList || toList.length === 0) {
      return res.status(400).json({ message: 'No recipients provided. Provide recipients or enable tenant contacts.' });
    }

    const waSetting = await WhatsAppSetting.findOne({ tenant: req.tenantId, isActive: true });
    const config = waSetting ? {
      provider: waSetting.provider,
      twilio: waSetting.twilio,
      meta: waSetting.meta,
    } : null;

    const results = [];
    for (const to of toList) {
      try {
        const body = defaultMsg;
        const sendRes = await sendWhatsApp({ to, body, config });
        results.push({ to, success: true, resp: sendRes });
      } catch (err) {
        results.push({ to, success: false, error: err.message });
      }
    }

    // Logger.info("sendSurveyWhatsApp", "Survey WhatsApp messages attempted", {
    //   context: {
    //     tenantId: req.tenantId,
    //     surveyId,
    //     recipients: toList.length
    //   },
    //   req
    // });
    res.status(200).json({ message: 'Send attempted', results });
  } catch (err) {
    console.error('sendSurveyWhatsApp error:', err);
    Logger.error("sendSurveyWhatsApp", "Failed to send survey WhatsApp", {
      error: err,
      context: {
        tenantId: req.tenantId
      },
      req
    });
    next(err);
  }
};

/**
 * Webhook to receive delivery / incoming messages (provider-dependent)
 * For Twilio, Twilio will POST status updates to configured webhook.
 * For Meta, the Graph API webhook structure differs.
 *
 * Minimal implementation: verify and log, then respond 200.
 */

// WhatsApp webhook handler
exports.whatsappWebhook = async (req, res) => {
  try {
    // Logger.info("whatsappWebhook", "Received WhatsApp webhook", {
    //   context: {
    //     body: req.body
    //   },
    //   req
    // });

    // TODO: provider-specific parsing and status update

    res.status(200).send('OK');
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    Logger.error("whatsappWebhook", "Error handling WhatsApp webhook", {
      error: err,
      context: {
        body: req.body
      },
      req
    });
    res.status(500).send('Error');
  }
};
