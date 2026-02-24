// utils/sendEmail.js
//
// Sends emails using the SendGrid transporter.
// Reads FROM_NAME and FROM_EMAIL via configService (DB → ENV → default).

const getTransporter = require('./emailTransporter');
const renderTemplate = require('./renderEmailTemplate');
const Logger = require('./logger');
const configService = require('../services/configService');

const sendEmail = async ({
  to,
  subject,
  html,
  text,
  templateType,
  templateData,
}) => {
  try {
    let finalHTML = html;
    let finalSubject = subject;

    if (templateType) {
      try {
        const templateResult = await renderTemplate({ templateType, templateData });
        if (templateResult) {
          finalHTML = templateResult.html || finalHTML;
          finalSubject = templateResult.subject || finalSubject;
        }
      } catch (templateError) {
        Logger.warn('sendEmail', `Template render failed for type: ${templateType}`, { error: templateError });
      }
    }

    if (!finalHTML) {
      finalHTML = '<p>No content provided.</p>';
    }

    // Read sender details via configService (DB → ENV → hardcoded default)
    const fromName = await configService.getConfig('FROM_NAME', {
      sensitive: false,
      defaultValue: 'RatePro',
    });
    const fromEmail = await configService.getConfig('FROM_EMAIL', {
      sensitive: false,
      defaultValue: 'noreply@ratepro.com',
    });

    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to,
      subject: finalSubject || 'Notification',
      html: finalHTML,
      text,
    };

    // 🚀 fire-and-forget
    getTransporter()
      .sendMail(mailOptions)
      .catch(err => {
        Logger.error('sendEmail', 'Email delivery failed', {
          to,
          subject: finalSubject,
          error: err.message,
        });
      });

  } catch (error) {
    Logger.error('sendEmail', 'Failed to prepare email', {
      to,
      subject,
      error: error.message,
    });
  }
};

module.exports = sendEmail;