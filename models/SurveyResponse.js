// models/SurveyResponse.js

const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  answer: mongoose.Schema.Types.Mixed, // string, number, etc.
  media: [
    {
      type: { type: String, enum: ["image", "audio", "video", "file"] },
      public_id: String,
      url: String,
    }
  ]
});

// Analysis metadata schema for AI-enriched responses
// Client Requirement 2: Each response enriched with analytical metadata
const analysisSchema = new mongoose.Schema({
  sentiment: { 
    type: String, 
    enum: ["positive", "neutral", "negative"],
    default: null
  },
  sentimentScore: { type: Number, min: -1, max: 1 }, // -1 to 1 scale
  urgency: { 
    type: String, 
    enum: ["low", "medium", "high"],
    default: null
  },
  emotions: [{ type: String }], // e.g., ["frustration", "appreciation"]
  keywords: [{ type: String }], // extracted keywords
  themes: [{ type: String }], // identified themes
  classification: {
    isComplaint: { type: Boolean, default: false },
    isPraise: { type: Boolean, default: false },
    isSuggestion: { type: Boolean, default: false }
  },
  summary: { type: String }, // AI-generated summary
  npsCategory: { 
    type: String, 
    enum: ["promoter", "passive", "detractor"],
    default: null
  },
  ratingCategory: {
    type: String,
    enum: ["excellent", "good", "average", "poor", "very_poor"],
    default: null
  },
  // ✅ NEW: Flag for dashboard visibility (Client Requirement 8)
  flaggedForReview: { type: Boolean, default: false },
  // ✅ NEW: Track what triggered the analysis
  triggeredRules: [{ type: String }],
  analyzedAt: { type: Date }
}, { _id: false });

const surveyResponseSchema = new mongoose.Schema(
  {
    survey: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Survey",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // 🔥 NEW: Link to Contact for invited responses
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
    },
    answers: [answerSchema],
    review: { type: String },
    score: { type: Number }, // 0–10 for NPS
    rating: { type: Number }, // 1–5
    submittedAt: { type: Date, default: Date.now },

    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

    isAnonymous: { type: Boolean, default: false },
    ip: { type: String }, // for public + anonymous tracking

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // optional
    status: {
      type: String,
      enum: ["partial", "submitted"],
      default: "submitted"
    },
    resumeToken: {
      type: String,
      unique: true,
      sparse: true // allows multiple nulls
    },
    lastSavedAt: { type: Date },
    currentQuestionIndex: { type: Number, default: 0 },
    
    // Analysis metadata (populated by postResponseProcessor)
    // Client Requirement 2: Response-Level Content Analysis
    analysis: analysisSchema,
    
    // Completion metrics
    completionTime: { type: Number }, // time in seconds to complete survey
  },
  { timestamps: true }
);

surveyResponseSchema.index({ tenant: 1, survey: 1 });
surveyResponseSchema.index({ resumeToken: 1 });
surveyResponseSchema.index({ "analysis.sentiment": 1 });
surveyResponseSchema.index({ "analysis.npsCategory": 1 });
// Add index for contact lookups
surveyResponseSchema.index({ contact: 1 });

module.exports = mongoose.model("SurveyResponse", surveyResponseSchema);