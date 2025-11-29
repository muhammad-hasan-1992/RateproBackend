
// const mongoose = require("mongoose");

// const tenantSchema = new mongoose.Schema({
//   name: { type: String, required: true, trim: true },
//   domain: { type: String },
//   contactEmail: { type: String },
//   address: { type: String },
//   isActive: { type: Boolean, default: true },
//   metadata: { type: mongoose.Schema.Types.Mixed },
//   createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
// }, { timestamps: true });

// module.exports = mongoose.model("Tenant", tenantSchema);

// const mongoose = require("mongoose");

// const tenantSchema = new mongoose.Schema(
//   {
//     // Basic Company Info
//     name: {
//       type: String,
//       required: [true, "Company name is required"],
//       trim: true,
//     },
//     contactEmail: {
//       type: String,
//       required: [true, "Company email is required"],
//       lowercase: true,
//     },
//     contactPhone: { type: String },
//     website: { type: String },
//     address: { type: String },
//     totalEmployees: { type: Number, default: 0 },

//     // Company Admin (the owner of this tenant)
//     companyAdmin: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },

//     // Departments (references to Department model)
//     departments: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "Department",
//       },
//     ],

//     // Company Members (all users belonging to this tenant)
//     members: [
//       {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "User",
//       },
//     ],

//     // Status Flags
//     isActive: { type: Boolean, default: true },
//     deleted: { type: Boolean, default: false },
//   },
//   { timestamps: true }
// );

// // Indexes for performance
// tenantSchema.index({ name: 1 });
// tenantSchema.index({ contactEmail: 1 });

// module.exports = mongoose.model("Tenant", tenantSchema);
// models/Tenant.js
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  // Linked to companyAdmin user
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  name: { type: String, required: true },
  contactEmail: { type: String },
  contactPhone: { type: String },
  website: { type: String },
  address: { type: String },
  totalEmployees: { type: Number, default: 0 },
  // Departments can be refs to Department model if complex
  departments: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
    }
  ],
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan',
    default: null
  },

  features: {
    type: Object,
    default: {
      aiSurveyGeneration: true,
      whatsappDistribution: false,
      smsDistribution: true,
      advancedAnalytics: true,
      customBranding: false,
      apiAccess: false,
      smartSegments: false,
      actionEngine: false,
      deliveryIntelligence: false,
      globalAiBrain: false,
      whiteLabel: false,
      prioritySupport: false,
    }
  },

  limits: {
    monthlyResponses: { type: Number, default: 500 },
    teamMembers: { type: Number, default: 3 },
    storageGB: { type: Number, default: 1 },
  },

  usage: {
    responsesThisMonth: { type: Number, default: 0 },
    surveysThisMonth: { type: Number, default: 0 },
  },
  products: [{ type: String }],
  contacts: [{ phone: String, name: String, role: String }],
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
