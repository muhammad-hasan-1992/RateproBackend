// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
  },
  authProvider: {
    type: String,
    enum: ["local", "google"],
    default: "local",
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    required: function () {
      return this.authProvider === "local";
    },
    minlength: 6,
  },
  phone: { type: String },
  bio: { type: String, default: "" },
  avatar: {
    public_id: { type: String },
    url: { type: String },
  },
  role: {
    type: String,
    enum: ["admin", "companyAdmin", "member", "user"],
    default: "user", // default for public signup
  },
  customRoles: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomRole",
      default: [],
    }
  ],
  isVerified: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  userType: {
    type: String,
    enum: ['internal', 'external'],
    default: 'internal'
  },
  // userCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UserCategory' }],
  deactivatedBy: { type: String, enum: ["admin", "companyAdmin", "member", null], default: null },
  // Auth Tokens
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  emailVerificationToken: String,
  emailTokenExpire: Date,
  // Creator reference
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  // Link to Tenant (for companyAdmin and members)
  tenant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Tenant",
    required: function () {
      return this.role === "companyAdmin" || this.role === "member";
    },
    default: null,
  },
  // Link to Department (for members, if defined)
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    required: function () {
      return this.role === "member" && this.userType === "internal";
    },
    default: null,
  },
  companyProfileUpdated: {
    type: Boolean,
    default: false,
    required: function () {
      return this.role === "companyAdmin";
    },
  },
  // Cross-department survey access for CompanyAdmin (explicit opt-in)
  crossDepartmentSurveyAccess: {
    type: Boolean,
    default: false, // Default false to prevent over-permissioning
  },
  // Link to SurveyStats (for users who take surveys)
  surveyStats: {
    type: mongoose.Schema.Types.ObjectId,
    // ref: "SurveyStats",
    required: function () {
      return this.role === "user";
    },
    default: null,
  },
  lastLogin: {
    type: Date,
    default: null,
  },
  deleted: {
    type: Boolean,
    default: false,
  },
  // Notification preferences
  notificationPreferences: {
    // Delivery channels
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    // Per-type toggles
    actionAssigned: { type: Boolean, default: true },
    actionEscalated: { type: Boolean, default: true },
    actionOverdue: { type: Boolean, default: true },
    actionCompleted: { type: Boolean, default: true },
    surveyResponses: { type: Boolean, default: true },
    systemAlerts: { type: Boolean, default: true }
  },
}, { timestamps: true });

// Hooks for validation (e.g., before save)
userSchema.pre('save', function (next) {
  if (this.role === 'member' && !this.tenant) {
    return next(new Error('Tenant required for members'));
  }
  // Similar for other conditions
  next();
});

module.exports = mongoose.model('User', userSchema);