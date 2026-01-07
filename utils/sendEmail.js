// // utils/sendEmail.js
// const nodemailer = require("nodemailer");
// const EmailTemplate = require("../models/EmailTemplate");

// const sendEmail = async ({ to, subject, html, text, templateType, templateData }) => {

//   try {
//     // -------------------- 1. TRANSPORTER INIT --------------------
//     const transporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST,
//       port: process.env.SMTP_PORT,
//       secure: false,
//       auth: {
//         user: process.env.SMTP_USER,
//         pass: process.env.SMTP_PASS,
//       },
//     });

//     let finalHTML = html;

//     // -------------------- 2. TEMPLATE HANDLING --------------------
//     if (templateType && templateData) {
//       const templateDoc = await EmailTemplate.findOne({ type: templateType, isActive: true });

//       if (!templateDoc) {
//         console.error("❌ Template not found in database:", templateType);
//         throw new Error("Email template not found");
//       }
//       finalHTML = templateDoc.body;

//       finalHTML = finalHTML.replace(
//         /\$\{\s*if\s+([\w]+)\s*===\s*"(\w+)"\s*\?\s*`([\s\S]*?)`\s*:\s*`([\s\S]*?)`\s*\}/g,
//         (match, variable, expected, trueBlock, falseBlock) => {
//           return templateData[variable] === expected ? trueBlock : falseBlock;
//         }
//       );

//       // console.log("🔍 Starting replacements...");
//       Object.keys(templateData).forEach((key) => {
//         const regex = new RegExp(`\\$\\{\\s*${key}\\s*\\}`, "g");

//         // console.log(`→ Checking key: ${key}`);
//         if (!finalHTML.match(regex)) {
//           console.warn(`⚠️ Placeholder not found in template: \${${key}}`);
//         }

//         finalHTML = finalHTML.replace(regex, templateData[key]);
//       });
//     }

//     // -------------------- 3. FALLBACK --------------------
//     if (!finalHTML) {
//       console.warn("⚠️ No HTML provided — using fallback");
//       finalHTML = "<p>No content provided.</p>";
//     }

//     // -------------------- 4. BUILD MAIL OPTIONS --------------------
//     const mailOptions = {
//       from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
//       to,
//       subject: subject || "Notification",
//       html: finalHTML,
//       text,
//     };
//     // -------------------- 5. SEND EMAIL --------------------
//     const info = await transporter.sendMail(mailOptions);

//     return info;

//   } catch (error) {
//     console.error("🔥 [FATAL ERROR in sendEmail]:", error.message);
//     console.error("🔍 STACK:", error.stack);
//     throw error;
//   }
// };

// module.exports = sendEmail;
const getTransporter = require('./emailTransporter');
const renderTemplate = require('./renderEmailTemplate');
const Logger = require('./logger');

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
      const rendered = await renderTemplate({
        templateType,
        templateData,
      });
      finalHTML = rendered.html;
      finalSubject = rendered.subject;
    }

    if (!finalHTML) {
      finalHTML = '<p>No content provided.</p>';
    }

    const mailOptions = {
      from: `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`,
      // from: 'shoukat.hasan@gmail.com',
      to,
      subject: finalSubject || 'Notification',
      html: finalHTML,
      text,
    };

    // 🚀 fire-and-forget
    getTransporter()
      .sendMail(mailOptions)
      .catch(err => {
        // 🚨 Log the actual error for debugging
        console.error('❌ [sendEmail] SMTP Error:', err.message);
        console.error('❌ [sendEmail] Full error:', err);
        
        Logger.error('sendEmail', 'Email send failed', {
          error: err,
          context: {
            to,
            subject: finalSubject,
            templateType,
          },
        });

        // 🚫 DO NOT rethrow
      });

  } catch (error) {
    // Template or render error (still non-blocking)
    Logger.error('sendEmail', 'Email preparation failed', {
      error,
      context: { to, templateType },
    });
  }
};

module.exports = sendEmail;