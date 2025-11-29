// models/Survey.js
const mongoose = require("mongoose");
const questionSchema = new mongoose.Schema({
  id: { type: String },
  questionText: { type: String, required: true },

  type: {
    type: String,
    enum: ["text", "textarea", "numeric", "email", "radio", "checkbox", "select", "imageChoice", "ranking", "matrix",
      "likert", "scale", "nps", "rating", "yesno", "date", "time", "datetime", "multiple_choice",
    ],
    required: true,
  },

  options: [String], // for mcq/choice/imageChoice/ranking etc.
  required: { type: Boolean, default: false },

  translations: {
    en: { questionText: String, options: [String] },
    ar: { questionText: String, options: [String] },
  },

  language: { type: String, enum: ["en", "ar"], default: "en" },

  // 🔥 Smart Logic Branching (Simplified)
  logicRules: [
    {
      condition: {
        operator: { type: String, enum: ["equals", "notEquals", "greaterThan", "lessThan", "includes"] },
        value: { type: mongoose.Schema.Types.Mixed }, // string/number/array
      },
      nextQuestionId: { type: String }, // string reference to another question.id
    },
  ],
});

const surveySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    logo: {
      public_id: String,
      url: String,
    },
    themeColor: { type: String, default: "#0047AB" },
    translations: {
      en: { title: String, description: String },
      ar: { title: String, description: String },
    },
    questions: [questionSchema],
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    settings: {
      isPublic: { type: Boolean, default: true },
      isAnonymous: { type: Boolean, default: false },
      isPasswordProtected: { type: Boolean, default: false },
      password: { type: String },
    },
    status: { type: String, enum: ["active", "inactive", "draft", "scheduled"], default: "draft" }, // ← "scheduled" add kiya!

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    totalResponses: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    deleted: { type: Boolean, default: false },

    // 🔥 YE 3 NAYE FIELDS ADD KAR RAHA HUN 🔥
    targetAudience: {
      type: { type: String, enum: ["all", "specific"], default: "specific" },
      emails: [{ type: String }],        // e.g., ["ali@gmail.com"]
      phones: [{ type: String }],        // e.g., ["+923001234567"]
      userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // internal employees
    },

    schedule: {
      startDate: { type: Date },
      endDate: { type: Date },
      timezone: { type: String, default: "Asia/Karachi" },
      autoPublish: { type: Boolean, default: true },
      repeat: {
        enabled: { type: Boolean, default: false },
        frequency: { type: String, enum: ["daily", "weekly", "monthly", "none"], default: "none" }
      },
      publishedAt: { type: Date } // jab actually publish hua
    },

    publishLog: [{
      publishedAt: { type: Date, default: Date.now },
      publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      method: { type: String, enum: ["manual", "auto", "cron"] },
      recipientsCount: { type: Number, default: 0 }
    }],

    sections: [{
      id: String,
      title: String,
      questions: [questionSchema]
    }],
    logicRules: [{ type: mongoose.Schema.Types.ObjectId, ref: 'LogicRule' }],

    thankYouPage: {
      message: { type: String, default: "Thank you for your feedback!" },
      qrCode: {
        enabled: { type: Boolean, default: false },
        url: { type: String },
      },
      redirectUrl: { type: String },
    },
  },
  { timestamps: true }
);

// Indexes for fast queries
surveySchema.index({ tenant: 1 });
surveySchema.index({ status: 1 });
surveySchema.index({ "schedule.startDate": 1 });
surveySchema.index({ "targetAudience.phones": 1 });

module.exports = mongoose.model("Survey", surveySchema);