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
  // Else-branch: if no logic rule matches, jump to this question (null = continue sequentially)
  defaultNextQuestionId: { type: String, default: null },
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
    language: {
      type: String,
      enum: ["en", "ar"],
      default: "en",
      required: true
    },
    questions: [questionSchema],
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    // Department ownership - null means company-level (managed by CompanyAdmin only)
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true
    },
    // Designated action/complaint manager for this survey
    actionManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    settings: {
      isPublic: { type: Boolean, default: true },
      isAnonymous: { type: Boolean, default: false },
      isPasswordProtected: { type: Boolean, default: false },
      password: { type: String },
    },
    status: { type: String, enum: ["active", "inactive", "draft", "scheduled", "published", "closed"], default: "draft" }, // ← "scheduled" add kiya!

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Responsible member assigned to manage this survey (null = creator is responsible)
    responsibleUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    totalResponses: { type: Number, default: 0 },
    lastResponseAt: { type: Date }, // 🔥 NEW: Track latest response time for sorting
    averageScore: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    deleted: { type: Boolean, default: false },

    // 🔥 YE 3 NAYE FIELDS ADD KAR RAHA HUN 🔥
    // targetAudience: {
    //   type: { type: String, enum: ["all", "specific"], default: "specific" },
    //   emails: [{ type: String }],        // e.g., ["ali@gmail.com"]
    //   phones: [{ type: String }],        // e.g., ["+923001234567"]
    //   userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // internal employees
    // },
    targetAudience: {
      audienceType: {
        type: String,
        enum: ["all", "category", "custom"],
        default: "custom"
      },

      categories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "ContactCategory"  // 🔥 Changed from "UserCategory"
      }],

      users: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User" // internal users
      }],

      contacts: [{
        name: String,
        email: String,
        phone: String
      }]
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

    version: { type: Number, default: 1 },
    publishedSnapshot: {
      questions: [questionSchema],
      lockedAt: Date
    },

    // Per-survey action permissions
    actionPermissions: {
      // Users who can assign actions from this survey (empty = all with role permission)
      allowedAssigners: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }],
      // Users who can view actions from this survey (empty = all with role permission)
      allowedViewers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }],
      // Restrict actions to specific team
      restrictToTeam: {
        type: String,
        default: null
      },
      // Restrict actions to specific department
      restrictToDepartment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        default: null
      },
      // Use survey-level permissions (false = use tenant-level only)
      enabled: {
        type: Boolean,
        default: false
      }
    },
  },
  { timestamps: true }
);

// Indexes for fast queries
surveySchema.index({ tenant: 1 });
surveySchema.index({ status: 1 });
surveySchema.index({ status: 1, tenant: 1 }); // Compound index for filtered listing
surveySchema.index({ "schedule.startDate": 1 });
surveySchema.index({ "targetAudience.contacts.phone": 1 });
surveySchema.index({ "targetAudience.contacts.email": 1 });

module.exports = mongoose.model("Survey", surveySchema);