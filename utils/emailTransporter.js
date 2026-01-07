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
const nodemailer = require('nodemailer');

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false, // Port 587 ke liye hamesha false rakhein
      auth: {
        user: 'apikey', 
        pass: process.env.SMTP_PASS, // Apni SG... API Key check karein
      },
      // Ye extra settings connection reset ko rokne mein madad karti hain
      tls: {
        rejectUnauthorized: false, // Unauthorized certificates ignore karne ke liye
        minVersion: 'TLSv1.2'      // SendGrid ko TLS 1.2+ chahiye hota hai
      },
      connectionTimeout: 10000, // 10 seconds timeout
    });
  }

  return transporter;
};

module.exports = getTransporter;