// middlewares/rateLimiter.js

const rateLimit = require("express-rate-limit");

exports.globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100, // max 100 requests/IP per 15 mins
  message: {
    status: 429,
    message: "Too many requests from this IP. Please try again later.",
  },
});

exports.authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: {
    status: 429,
    message: "Too many auth attempts. Please wait and try again.",
  },
});

// ⬅️ ADD: Survey response rate limiter
exports.surveyResponseLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 submissions per minute per IP
  message: {
    status: 429,
    message: "Too many submissions. Please wait before submitting again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ⬅️ ADD: Anonymous survey abuse prevention
exports.anonymousSurveyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 50, // 50 anonymous responses per day per IP
  message: {
    status: 429,
    message: "Daily submission limit reached. Please try again tomorrow.",
  },
});

// ⬅️ ADD: Config email test limiter (prevent SendGrid credit burn / spam)
exports.configEmailTestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // 3 test emails per 5 minutes per admin
  message: {
    status: 429,
    message: "Too many test emails. Please wait 5 minutes before trying again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

