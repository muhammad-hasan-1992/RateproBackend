// utils/emailTransporter.js
//
// Email transport using SendGrid.
// Reads API key via configService (DB → ENV → throw).
// Lazy-initializes on first send to allow async config lookup.

const sgMail = require('@sendgrid/mail');
const configService = require('../services/configService');

let _initialized = false;

/**
 * Ensure SendGrid is initialized with the API key from configService.
 * Called once before the first send; subsequent calls are a no-op.
 */
const ensureInitialized = async () => {
  if (_initialized) return;

  const apiKey = await configService.getConfig('SENDGRID_API_KEY', {
    sensitive: true, // DB → ENV → THROW (no fallback)
  });

  sgMail.setApiKey(apiKey);
  _initialized = true;
};

/**
 * Get the email transporter (SendGrid adapter).
 * Maintains the same interface as before for backward compatibility.
 * @returns {{ sendMail: Function }}
 */
const getTransporter = () => {
  return {
    sendMail: async (mailOptions) => {
      await ensureInitialized();

      const msg = {
        to: mailOptions.to,
        from: mailOptions.from,
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
      };
      return sgMail.send(msg);
    },
  };
};

module.exports = getTransporter;