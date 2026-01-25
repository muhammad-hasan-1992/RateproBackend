// utils/sendNotification.js
const Notification = require("../models/Notification");
const User = require("../models/User");

/**
 * Notification type to category mapping
 */
const TYPE_CATEGORY_MAP = {
  action_assigned: "action",
  action_status_updated: "action",
  action_escalated: "action",
  action_overdue: "action",
  action_completed: "action",
  bulk_action_assigned: "action",
  survey_response: "survey",
  feedback_received: "feedback",
  system: "system",
};

/**
 * Notification type to priority mapping
 */
const TYPE_PRIORITY_MAP = {
  action_escalated: "urgent",
  action_overdue: "high",
  action_assigned: "medium",
  bulk_action_assigned: "medium",
  action_status_updated: "low",
  action_completed: "low",
};

/**
 * Send notification to user - persists to database
 * @param {Object} options - Notification options
 * @param {String} options.userId - User ID to send notification to
 * @param {String} options.type - Notification type
 * @param {String} options.message - Notification message
 * @param {String} options.title - Optional title (defaults to type-based title)
 * @param {Object} options.data - Additional data/metadata
 * @param {String} options.actionUrl - Optional deep link URL
 * @returns {Object} - { success, notification }
 */
exports.sendNotification = async (options) => {
  try {
    const { userId, type, message, title, data = {}, actionUrl = null, skipPreferenceCheck = false } = options;

    if (!userId) {
      console.warn("sendNotification: No userId provided, skipping");
      return { success: false, error: "No userId provided" };
    }

    // Get user to find tenant and preferences
    const user = await User.findById(userId).select("tenant name email notificationPreferences").lean();
    if (!user) {
      console.warn(`sendNotification: User ${userId} not found, skipping`);
      return { success: false, error: "User not found" };
    }

    // Check user notification preferences
    if (!skipPreferenceCheck && user.notificationPreferences) {
      const prefs = user.notificationPreferences;

      // Check if in-app notifications are disabled
      if (prefs.inApp === false) {
        return { success: false, skipped: true, reason: "User disabled in-app notifications" };
      }

      // Check per-type preferences
      const typeToPreference = {
        action_assigned: "actionAssigned",
        bulk_action_assigned: "actionAssigned",
        action_escalated: "actionEscalated",
        action_overdue: "actionOverdue",
        action_completed: "actionCompleted",
        action_status_updated: "actionAssigned",
        survey_response: "surveyResponses",
        feedback_received: "surveyResponses",
        system: "systemAlerts"
      };

      const prefKey = typeToPreference[type];
      if (prefKey && prefs[prefKey] === false) {
        return { success: false, skipped: true, reason: `User disabled ${type} notifications` };
      }
    }

    // Determine notification category and priority
    const category = TYPE_CATEGORY_MAP[type] || "system";
    const priority = TYPE_PRIORITY_MAP[type] || "medium";

    // Generate title if not provided
    const notificationTitle = title || generateTitle(type);

    // Map legacy type to new enum if needed
    const notificationType = mapToValidType(type);

    // Create notification in database
    const notification = await Notification.create({
      user: userId,
      tenant: user.tenant,
      title: notificationTitle,
      message,
      type: notificationType,
      priority,
      status: "unread",
      metadata: data,
      actionUrl,
      source: data.source || "action_engine",
      reference: data.actionId ? { type: "Action", id: data.actionId } :
        data.surveyId ? { type: "Survey", id: data.surveyId } : null
    });

    // Emit real-time notification via Socket.IO (if available)
    try {
      const { emitToUser } = require("./socket");
      emitToUser(userId.toString(), "notification", {
        id: notification._id,
        title: notificationTitle,
        message,
        type: notificationType,
        priority,
        data,
        createdAt: notification.createdAt
      });
    } catch (socketError) {
      // Socket.IO not initialized or error - continue silently
    }

    // Log for debugging (in development)
    if (process.env.NODE_ENV !== "production") {
      console.log(`📢 Notification created for user ${userId}:`, {
        id: notification._id,
        type: notificationType,
        title: notificationTitle,
        message: message.substring(0, 50) + "...",
      });
    }

    return { success: true, notification };

  } catch (error) {
    console.error("sendNotification error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Generate title based on notification type
 */
function generateTitle(type) {
  const titles = {
    action_assigned: "New Action Assigned",
    action_status_updated: "Action Status Updated",
    action_escalated: "Action Escalated",
    action_overdue: "Action Overdue",
    action_completed: "Action Completed",
    bulk_action_assigned: "Actions Assigned",
    survey_response: "New Survey Response",
    feedback_received: "New Feedback Received",
    system: "System Notification",
  };
  return titles[type] || "Notification";
}

/**
 * Map legacy types to valid enum values
 */
function mapToValidType(type) {
  const validTypes = ["info", "success", "warning", "error", "alert", "action", "survey", "system"];

  // If it's already valid, return as-is
  if (validTypes.includes(type)) return type;

  // Map action-related types to "action"
  if (type.startsWith("action_") || type.startsWith("bulk_action")) return "action";

  // Map survey-related types
  if (type.startsWith("survey_") || type.startsWith("feedback_")) return "survey";

  // Default to system
  return "system";
}

/**
 * Send notification to multiple users
 */
exports.sendBulkNotifications = async (userIds, options) => {
  const results = await Promise.allSettled(
    userIds.map(userId => exports.sendNotification({ ...options, userId }))
  );

  const successful = results.filter(r => r.status === "fulfilled" && r.value.success).length;
  const failed = results.length - successful;

  return { successful, failed, total: results.length };
};

/**
 * Send email notification for critical action alerts
 * Uses SendGrid if configured, falls back to nodemailer
 */
async function sendEmailNotification(user, type, title, message, data = {}) {
  try {
    // Check if user has email notifications enabled
    if (user.notificationPreferences?.email === false) {
      return { success: false, skipped: true, reason: "User disabled email notifications" };
    }

    // Only send emails for critical notification types
    const emailableTypes = ["action_escalated", "action_overdue", "action_assigned", "bulk_action_assigned"];
    if (!emailableTypes.includes(type)) {
      return { success: false, skipped: true, reason: "Type not emailable" };
    }

    // Try to use sendEmail utility if available
    try {
      const sendEmail = require("./sendEmail");

      await sendEmail({
        to: user.email,
        subject: title,
        templateType: "action_notification",
        templateData: {
          userName: user.name,
          notificationTitle: title,
          notificationMessage: message,
          actionUrl: data.actionUrl || process.env.ADMIN_URL_PROD + "/actions",
          actionTitle: data.actionTitle || "View Action",
          priority: data.priority || "medium",
          companyName: "RatePro",
          currentYear: new Date().getFullYear()
        }
      });

      return { success: true };
    } catch (emailError) {
      // sendEmail not available or failed
      console.log("Email notification skipped (sendEmail not configured):", emailError.message);
      return { success: false, error: emailError.message };
    }
  } catch (error) {
    console.error("sendEmailNotification error:", error);
    return { success: false, error: error.message };
  }
}

exports.sendEmailNotification = sendEmailNotification;

