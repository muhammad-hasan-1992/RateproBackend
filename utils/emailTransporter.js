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
  if (_initialized) {
    // console.log('[EmailTransporter] Already initialized, skipping.');
    return;
  }

  // console.log('[EmailTransporter] Initializing – fetching SENDGRID_API_KEY from configService...');

  try {
    const apiKey = await configService.getConfig('SENDGRID_API_KEY', {
      sensitive: true, // DB → ENV → THROW (no fallback)
    });

    // Log masked key so we can confirm it was retrieved without exposing the secret
    const masked = apiKey
      ? `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)} (length: ${apiKey.length})`
      : 'EMPTY / UNDEFINED';
    // console.log(`[EmailTransporter] API key retrieved: ${masked}`);

    sgMail.setApiKey(apiKey);
    _initialized = true;
    // console.log('[EmailTransporter] SendGrid API key set successfully. Initialization complete.');
  } catch (err) {
    // console.error('[EmailTransporter] ❌ Failed to initialize SendGrid:', err.message);
    throw err;
  }
};

/**
 * Get the email transporter (SendGrid adapter).
 * Maintains the same interface as before for backward compatibility.
 * @returns {{ sendMail: Function }}
 */
const getTransporter = () => {
  return {
    sendMail: async (mailOptions) => {
      // console.log('[EmailTransporter] sendMail() called with options:', {
      //   to: mailOptions.to,
      //   from: mailOptions.from,
      //   subject: mailOptions.subject,
      //   hasText: !!mailOptions.text,
      //   hasHtml: !!mailOptions.html,
      // });

      try {
        await ensureInitialized();
      } catch (initErr) {
        console.error('[EmailTransporter] ❌ Initialization failed, cannot send email:', initErr.message);
        throw initErr;
      }

      const msg = {
        to: mailOptions.to,
        from: mailOptions.from,
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
      };

      console.log('[EmailTransporter] Sending email via SendGrid...');
      console.log('[EmailTransporter] Message payload:', JSON.stringify({
        to: msg.to,
        from: msg.from,
        subject: msg.subject,
        textLength: msg.text ? msg.text.length : 0,
        htmlLength: msg.html ? msg.html.length : 0,
      }, null, 2));

      try {
        const response = await sgMail.send(msg);
        // console.log('[EmailTransporter] ✅ Email sent successfully!');
        // console.log('[EmailTransporter] Response status code:', response?.[0]?.statusCode);
        // console.log('[EmailTransporter] Response headers:', JSON.stringify(response?.[0]?.headers, null, 2));
        return response;
      } catch (sendErr) {
        console.error('[EmailTransporter] ❌ SendGrid send failed!');
        console.error('[EmailTransporter] Error message:', sendErr.message);
        console.error('[EmailTransporter] Error code:', sendErr.code);
        if (sendErr.response) {
          console.error('[EmailTransporter] Response status:', sendErr.response?.statusCode);
          console.error('[EmailTransporter] Response body:', JSON.stringify(sendErr.response?.body, null, 2));
        }
        throw sendErr;
      }
    },
  };
};

module.exports = getTransporter;