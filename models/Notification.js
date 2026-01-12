// models/Notification.js
const mongoose = require("mongoose");

/**
 * Notification Schema
 * 
 * Stores in-app notifications for users across tenants.
 * Supports multiple notification types and priority levels.
 * 
 * Usage:
 * - System alerts (urgent actions, errors)
 * - Survey-related notifications (new responses, published surveys)
 * - Action-related notifications (assigned, due soon, overdue)
 * - General info notifications
 */

const notificationSchema = new mongoose.Schema(
  {
    // Recipient user
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Tenant isolation
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    // Notification content
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
      maxlength: 200,
    },

    message: {
      type: String,
      required: [true, "Notification message is required"],
      trim: true,
      maxlength: 1000,
    },

    // Notification type for UI styling and filtering
    type: {
      type: String,
      enum: ["info", "success", "warning", "error", "alert", "action", "survey", "system"],
      default: "info",
    },

    // Priority level for sorting and display
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },

    // Read status
    status: {
      type: String,
      enum: ["unread", "read", "archived"],
      default: "unread",
    },

    // Reference to related entity (polymorphic)
    reference: {
      type: {
        type: String,
        enum: ["Action", "Survey", "SurveyResponse", "User", "Ticket", null],
        default: null,
      },
      id: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
    },

    // Optional action URL for deep linking
    actionUrl: {
      type: String,
      default: null,
    },

    // Metadata for additional context
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Expiry date (optional - for auto-cleanup)
    expiresAt: {
      type: Date,
      default: null,
    },

    // Read timestamp
    readAt: {
      type: Date,
      default: null,
    },

    // Source of notification
    source: {
      type: String,
      enum: ["system", "user", "action_engine", "ai", "cron", "api"],
      default: "system",
    },

    // Soft delete
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Primary query: user's notifications by status (unread first)
notificationSchema.index({ user: 1, status: 1, createdAt: -1 });

// Tenant-wide notifications query
notificationSchema.index({ tenant: 1, createdAt: -1 });

// Filter by type
notificationSchema.index({ user: 1, type: 1, createdAt: -1 });

// Cleanup expired notifications
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Reference lookup
notificationSchema.index({ "reference.type": 1, "reference.id": 1 });

// ============================================================================
// VIRTUALS
// ============================================================================

// Check if notification is expired
notificationSchema.virtual("isExpired").get(function () {
  return this.expiresAt && new Date() > this.expiresAt;
});

// Check if notification is recent (within 24 hours)
notificationSchema.virtual("isRecent").get(function () {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.createdAt > oneDayAgo;
});

// ============================================================================
// PRE-SAVE MIDDLEWARE
// ============================================================================

notificationSchema.pre("save", function (next) {
  // Set readAt when status changes to read
  if (this.isModified("status") && this.status === "read" && !this.readAt) {
    this.readAt = new Date();
  }
  next();
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get unread count for a user
 */
notificationSchema.statics.getUnreadCount = async function (userId, tenantId) {
  return this.countDocuments({
    user: userId,
    tenant: tenantId,
    status: "unread",
    deleted: false,
  });
};

/**
 * Mark all as read for a user
 */
notificationSchema.statics.markAllAsRead = async function (userId, tenantId) {
  return this.updateMany(
    { user: userId, tenant: tenantId, status: "unread", deleted: false },
    { $set: { status: "read", readAt: new Date() } }
  );
};

/**
 * Create batch notifications for multiple users
 */
notificationSchema.statics.createBatch = async function (notifications) {
  return this.insertMany(notifications, { ordered: false });
};

module.exports = mongoose.model("Notification", notificationSchema);