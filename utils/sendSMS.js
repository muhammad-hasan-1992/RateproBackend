// utils/sendSMS.js
//
// SMS sending via Twilio.
// Reads credentials via configService (DB → ENV → throw).
// Uses lazy async initialization to avoid sync process.env at module load.

const twilio = require("twilio");
const configService = require("../services/configService");

let _client = null;

/**
 * Get a lazily-initialized Twilio client.
 * Reads SID and Auth Token from configService on first call.
 */
const getClient = async () => {
  if (_client) return _client;

  const sid = await configService.getConfig("SMS_PROVIDER_SID", { sensitive: true });
  const authToken = await configService.getConfig("SMS_PROVIDER_AUTH_TOKEN", { sensitive: true });

  _client = twilio(sid, authToken);
  return _client;
};

/**
 * Send SMS using Twilio (or another provider if swapped later).
 * @param {Object} options
 * @param {string} options.to - Recipient phone number (E.164 format, e.g. +15555555555)
 * @param {string} options.body - Message text
 */
exports.sendSMS = async ({ to, body }) => {
  try {
    const client = await getClient();

    const senderNumber = await configService.getConfig("SMS_PROVIDER_NUMBER", {
      sensitive: false,
      defaultValue: undefined, // No default — must be configured
    });

    if (!senderNumber) {
      throw new Error("SMS sender number not configured. Set SMS_PROVIDER_NUMBER via admin panel or .env");
    }

    const message = await client.messages.create({
      body,
      to,
      from: senderNumber,
    });

    return { sid: message.sid, status: message.status };
  } catch (err) {
    console.error("SMS Send Error:", err);
    throw new Error("SMS service failed. Please try again later.");
  }
};
