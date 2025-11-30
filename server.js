// // server.js
// require("dotenv").config();
// const express = require("express");
// const connectDB = require("./config/db");
// const cookieParser = require("cookie-parser");
// const cors = require("cors");
// const path = require("path");
// const { globalLimiter } = require("./middlewares/rateLimiter");
// const cron = require('node-cron');
// const seedContactCategories = require("./seeds/seedContactCategories");

// // MongoDB connection and seeding
// const startServer = async () => {
//   try {
//     await connectDB();
//     // await seedContactCategories();
//     // await seedSurveyTemplates();
//     // await seedPermissions(); // Run permission seeding after DB connection
//   } catch (err) {
//     console.error("Server startup error:", err);
//     process.exit(1);
//   }
// };

// startServer();

// const app = express();

// app.set("trust proxy", 1);

// // CORS allowed origins
// const allowedOrigins = [
//   process.env.PUBLIC_URL_LOCAL || "http://localhost:5173",
//   process.env.ADMIN_URL_LOCAL || "http://localhost:5174",
//   process.env.PUBLIC_URL_PROD || "https://rate-pro-public.vercel.app",
//   process.env.ADMIN_URL_PROD || "https://rate-pro-admin-six.vercel.app",
//   'http://192.168.0.4:5173/'
// ];

// // Middleware
// app.use(
//   cors({
//     origin: function (origin, callback) {
//       if (!origin || allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error("Not allowed by CORS"));
//       }
//     },
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // ✅ moved here
//   })
// );


// app.use(express.json({ limit: "10mb" }));
// app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// app.use(cookieParser());
// app.use(globalLimiter);

// // Static folder for uploads (avatars, PDFs, etc.)
// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// // // Routes
// app.use("/api/auth", require("./routes/authRoutes"));
// app.use("/api/users", require("./routes/userRoutes"));
// app.use("/api/contact-categories", require("./routes/contactCategoryRoutes"));
// app.use('/api/tenants', require("./routes/tenantRoutes"));
// app.use("/api/roles", require("./routes/roleRoutes"));
// app.use("/api/permissions", require("./routes/permissionRoutes.js"));
// app.use('/api', require("./routes/permissionAssignmentRoutes.js"));
// app.use("/api/surveys", require("./routes/surveyRoutes"));
// app.use("/api/survey-templates", require("./routes/surveyTemplatesRoutes"));
// app.use("/api/ai", require("./routes/aiRoutes"));
// app.use("/api/actions", require("./routes/actionRoutes"));
// app.use("/api/analytics", require("./routes/analyticsRoutes"));
// // app.use("/api/subscriptions", require("./routes/subscriptionRoutes"));
// app.use("/api/sms", require("./routes/smsRoutes"));
// app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
// app.use("/api/insights", require("./routes/insightRoutes"));
// app.use("/api/feedback", require("./routes/feedbackRoutes"));
// app.use("/api/distribution", require("./routes/distributionRoutes"));
// app.use("/api/dashboard", require("./routes/dashboardRoutes"));
// app.use("/api/tickets", require("./routes/ticketRoutes"));
// app.use("/api/email-templates", require("./routes/emailTemplateRoutes.js"));
// // app.use("/api/segments", require("../removed files backup/audienceSegmentRoutes.js"));
// app.use("/api/contacts", require("./routes/contactManagementRoutes.js"));
// app.use("/api", require("./routes/logicEngineRoutes"));

// cron.schedule('*/5 * * * *', () => {
//   require('./controllers/surveyController').autoPublishScheduledSurveys();
// });

// // Error Handling Middleware
// const { notFound, errorHandler } = require("./middlewares/errorHandler");
// const seedSurveyTemplates = require("./seeds/seedSurveyTemplates.js");
// app.use(notFound);
// app.use(errorHandler);

// // Server Boot
// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () =>
//   console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
// );

// server.js
require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");
// Middlewares
const { globalLimiter } = require("./middlewares/rateLimiter");
const { notFound, errorHandler } = require("./middlewares/errorHandler");

// Seeds
// const seedContactCategories = require("./seeds/seedContactCategories");
// const seedSurveyTemplates = require("./seeds/seedSurveyTemplates");

const app = express();

// ----------------------
// Database Init
// ----------------------
(async () => {
  try {
    await connectDB();
    // await seedContactCategories();
    // await seedSurveyTemplates();
  } catch (err) {
    console.error("DB Connection Failed:", err);
    process.exit(1);
  }
})();

// ----------------------
// Core Middleware
// ----------------------
// app.set("trust proxy", 1);
// app.set("trust proxy", true);
app.enable("trust proxy");

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://192.168.0.4:5173",

  // frontend production
  "https://rate-pro-public.vercel.app",
  "https://rate-pro-admin-six.vercel.app",
  "https://rateprobackend-production-c52f.up.railway.app",
];

// app.use(
//   cors({
//     origin: (origin, callback) => {
//       if (!origin || allowedOrigins.includes(origin)) {
//         return callback(null, true);
//       }
//       return callback(new Error("Not allowed by CORS"));
//     },
//     credentials: true,
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//   })
// );
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(globalLimiter);

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ----------------------
// Routes (Clean Grouped)
// ----------------------
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));

app.use("/api/contact-categories", require("./routes/contactCategoryRoutes"));
app.use("/api/tenants", require("./routes/tenantRoutes"));

app.use("/api/roles", require("./routes/roleRoutes"));
app.use("/api/permissions", require("./routes/permissionRoutes"));
app.use("/api/permission-assignments", require("./routes/permissionAssignmentRoutes"));

app.use("/api/surveys", require("./routes/surveyRoutes"));
app.use("/api/survey-templates", require("./routes/surveyTemplatesRoutes"));

app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/actions", require("./routes/actionRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));

app.use("/api/sms", require("./routes/smsRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));

app.use("/api/insights", require("./routes/insightRoutes"));
app.use("/api/feedback", require("./routes/feedbackRoutes"));

app.use("/api/distribution", require("./routes/distributionRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));

app.use("/api/tickets", require("./routes/ticketRoutes"));
app.use("/api/email-templates", require("./routes/emailTemplateRoutes"));

app.use("/api/contacts", require("./routes/contactManagementRoutes"));
app.use("/api/logic-engine", require("./routes/logicEngineRoutes"));

app.use('/api/plans', require('./routes/planRoutes'));

// ----------------------
// Cron Jobs
// ----------------------
const { autoPublishScheduledSurveys } = require("./controllers/surveyController");
cron.schedule("*/5 * * * *", autoPublishScheduledSurveys);

// ----------------------
// Error Handling
// ----------------------
app.use(notFound);
app.use(errorHandler);

// ----------------------
// Server Boot
// ----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);