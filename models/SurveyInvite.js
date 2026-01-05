// RateproBackend/models/SurveyInvite.js
const mongoose = require("mongoose");

const surveyInviteSchema = new mongoose.Schema({
  survey: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Survey",
    required: true,
    index: true
  },

  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: true
  },

  // Recipient (only ONE will be filled)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  contact: {
    name: String,
    email: String,
    phone: String
  },

  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  status: {
    type: String,
    enum: ["sent", "opened", "responded"],
    default: "sent"
  },

  openedAt: {
    type: Date
  },

  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  },
  maxAttempts: { type: Number, default: 1 },
  attemptCount: { type: Number, default: 0 },

  respondedAt: {
    type: Date
  }

}, { timestamps: true });

module.exports = mongoose.model("SurveyInvite", surveyInviteSchema);
