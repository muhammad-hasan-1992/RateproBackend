// server.js
require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");
const { globalLimiter } = require("./middlewares/rateLimiter");
const cron = require('node-cron');
const { notFound, errorHandler } = require("./middlewares/errorHandler");
const retagInactiveContacts = require("./jobs/retagInactiveContacts.job.js");
const { syncSystemSegments } = require("./crons/systemSegments.cron.js");
const { autoCloseSurveys } = require("./crons/autoCloseSurveys.cron.js"); 
const { recomputeAudienceIntelligence } = require("./jobs/audience/recomputeAudienceIntelligence.job");

// MongoDB connection and seeding
const startServer = async () => {
  try {
    await connectDB();
  } catch (err) {
    console.error("Server startup error:", err);
    process.exit(1);
  }
};

startServer();

const app = express();

app.set("trust proxy", 1);

// CORS allowed origins
const allowedOrigins = [
  process.env.PUBLIC_URL_LOCAL || "http://localhost:5173",
  process.env.ADMIN_URL_LOCAL || "http://localhost:5174",
  process.env.PUBLIC_URL_PROD || "https://rate-pro-public.vercel.app",
  process.env.ADMIN_URL_PROD || "https://rate-pro-admin-six.vercel.app",
  'http://192.168.0.4:5173/'
];

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // ✅ moved here
  })
);


app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(globalLimiter);

// Static folder for uploads (avatars, PDFs, etc.)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));

app.use("/api/contact-categories", require("./routes/contactCategoryRoutes"));

// 🔥 UPDATED: Use consolidated contact routes (removed duplicate)
app.use("/api/contacts", require("./routes/contact.routes"));

// 🔥 ADDED: Segments route
app.use("/api/segments", require("./routes/segmentation.routes"));

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

cron.schedule('*/5 * * * *', () => {
  require('./controllers/surveyController').autoPublishScheduledSurveys();
});

cron.schedule('0 2 * * *', async () => {
  await retagInactiveContacts();
  await syncSystemSegments();
  await autoCloseSurveys();
  recomputeAudienceIntelligence().catch((err) => {
    console.error('Audience intelligence refresh failed', err);
  });
});

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

// Server Boot
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
);