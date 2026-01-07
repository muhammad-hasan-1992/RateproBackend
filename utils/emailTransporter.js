// // utils/emailTransporter.js
// const nodemailer = require('nodemailer');

// let transporter;

// const getTransporter = () => {
//   if (!transporter) {
//     transporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST,
//       port: Number(process.env.SMTP_PORT),
//       secure: false,
//       auth: {
//         user: process.env.SMTP_USER,
//         pass: process.env.SMTP_PASS,
//       },
//       tls: {
//         rejectUnauthorized: false // Kabhi kabhi cloud servers par self-signed certificates ka issue aata hai, ye usay handle kar leta hai
//       },
//     });
//   }

//   return transporter;
// };

// module.exports = getTransporter;
// utils/emailTransporter.js
// utils/emailTransporter.js
const sgMail = require('@sendgrid/mail');

// API Key ko set karein
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const getTransporter = () => {
  // Hum abhi bhi purane structure ko follow kar rahe hain taake code crash na ho
  return {
    sendMail: async (mailOptions) => {
      const msg = {
        to: mailOptions.to,
        from: mailOptions.from, // Ensure karein ye verified email hai
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html,
      };
      return sgMail.send(msg);
    }
  };
};

module.exports = getTransporter;