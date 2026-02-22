// utils/sendWhatsApp.js
//
// WhatsApp messaging via Twilio or Meta.
// Reads credentials via configService (DB → ENV → throw) when no
// tenant-level config is passed in the `config` parameter.

const axios = require('axios');
const Twilio = require('twilio');
const configService = require('../services/configService');

async function sendViaTwilio({ to, body, mediaUrls = [], twilioConfig }) {
  if (!twilioConfig || !twilioConfig.accountSid) throw new Error('Twilio not configured');
  const client = Twilio(twilioConfig.accountSid, twilioConfig.authToken);

  const messages = [];
  const toFmt = `whatsapp:${to}`;
  const fromFmt = twilioConfig.fromNumber.startsWith('whatsapp:')
    ? twilioConfig.fromNumber
    : `whatsapp:${twilioConfig.fromNumber}`;

  if (mediaUrls && mediaUrls.length) {
    messages.push(await client.messages.create({
      from: fromFmt,
      to: toFmt,
      body,
      mediaUrl: mediaUrls,
    }));
  } else {
    messages.push(await client.messages.create({
      from: fromFmt,
      to: toFmt,
      body,
    }));
  }
  return messages;
}

async function sendViaMeta({ to, body, mediaUrls = [], metaConfig }) {
  if (!metaConfig || !metaConfig.accessToken || !metaConfig.phoneNumberId)
    throw new Error('Meta WhatsApp not configured');

  const url = `https://graph.facebook.com/v16.0/${metaConfig.phoneNumberId}/messages`;
  const headers = { Authorization: `Bearer ${metaConfig.accessToken}` };

  const payload = {
    messaging_product: 'whatsapp',
    to: to.replace(/^\+/, ''),
    type: mediaUrls && mediaUrls.length ? 'image' : 'text',
  };

  if (mediaUrls && mediaUrls.length) {
    payload.image = { link: mediaUrls[0] };
    payload.text = { body };
  } else {
    payload.text = { body };
    payload.type = 'text';
  }

  const resp = await axios.post(url, payload, { headers });
  return resp.data;
}

/**
 * Main exported function:
 * @param {Object} options
 * @param {string} options.to - Recipient phone (E.164)
 * @param {string} options.body - Message body
 * @param {string[]} [options.mediaUrls] - Optional media URLs
 * @param {Object} [options.config] - Tenant-level config override (from WhatsAppSetting model)
 */
module.exports = async function sendWhatsApp({ to, body, mediaUrls = [], config = null }) {
  const provider = (config && config.provider) || process.env.WHATSAPP_PROVIDER || 'twilio';

  if (provider === 'twilio') {
    // Use passed config first, then fall back to configService (DB → ENV → throw)
    const twilioCfg = (config && config.twilio) || {
      accountSid: await configService.getConfig('TWILIO_ACCOUNT_SID', { sensitive: true }),
      authToken: await configService.getConfig('TWILIO_AUTH_TOKEN', { sensitive: true }),
      fromNumber: await configService.getConfig('TWILIO_WHATSAPP_FROM', {
        sensitive: false,
        defaultValue: undefined,
      }),
    };
    return await sendViaTwilio({ to, body, mediaUrls, twilioConfig: twilioCfg });

  } else if (provider === 'meta') {
    const metaCfg = (config && config.meta) || {
      phoneNumberId: await configService.getConfig('META_WHATSAPP_PHONE_NUMBER_ID', {
        sensitive: false,
        defaultValue: undefined,
      }),
      accessToken: await configService.getConfig('META_WHATSAPP_TOKEN', { sensitive: true }),
    };
    return await sendViaMeta({ to, body, mediaUrls, metaConfig: metaCfg });

  } else {
    throw new Error('Unsupported WhatsApp provider');
  }
};
