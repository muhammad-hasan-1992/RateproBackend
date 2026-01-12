// services/notifications/notificationService.js
const Notification = require("../../models/Notification");
const Tenant = require("../../models/Tenant");
const User = require("../../models/User");
const Logger = require("../../utils/auditLog");

// ============================================================================
// NOTIFICATION CREATION
// ============================================================================

/**
 * Create a single notification
 * @param {Object} params - Notification parameters
 * @returns {Promise<Object>} Created notification
 */
exports.createNotification = async ({
  userId,
  tenantId,
  title,
  message,
  type = "info",
  priority = "medium",
  reference = null,
  actionUrl = null,
  metadata = {},
  expiresAt = null,
  source = "system",
}) => {
  try {
    console.log(`\n📬 [NotificationService] Creating notification...`);
    console.log(`   User: ${userId}`);
    console.log(`   Title: ${title}`);
    console.log(`   Type: ${type}, Priority: ${priority}`);

    const notification = await Notification.create({
      user: userId,
      tenant: tenantId,
      title,
      message,
      type,
      priority,
      reference,
      actionUrl,
      metadata,
      expiresAt,
      source,
    });

    console.log(`   ✅ Notification created: ${notification._id}`);

    Logger.info("notification", "Notification created", {
      context: {
        notificationId: notification._id,
        userId,
        tenantId,
        type,
        priority,
      },
    });

    return notification;
  } catch (error) {
    console.error(`   ❌ Failed to create notification:`, error.message);
    Logger.error("notification", "Failed to create notification", {
      error: error.message,
      context: { userId, tenantId, title },
    });
    throw error;
  }
};

/**
 * Create batch notifications for multiple users
 * @param {Array} notifications - Array of notification objects
 * @returns {Promise<Object>} Result with inserted count
 */
exports.createBatchNotifications = async (notifications) => {
  try {
    console.log(`\n📬 [NotificationService] Creating batch notifications...`);
    console.log(`   Count: ${notifications.length}`);

    const result = await Notification.createBatch(notifications);

    console.log(`   ✅ Batch created: ${result.length} notifications`);

    Logger.info("notification", "Batch notifications created", {
      context: { count: result.length },
    });

    return {
      success: true,
      insertedCount: result.length,
      notifications: result,
    };
  } catch (error) {
    console.error(`   ❌ Batch creation failed:`, error.message);
    Logger.error("notification", "Batch creation failed", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Notify all tenant admins
 * @param {Object} params - Notification parameters (without userId)
 * @returns {Promise<Array>} Created notifications
 */
exports.notifyTenantAdmins = async ({
  tenantId,
  title,
  message,
  type = "alert",
  priority = "high",
  reference = null,
  actionUrl = null,
  metadata = {},
}) => {
  try {
    // Find all admin users for this tenant
    const admins = await User.find({
      tenant: tenantId,
      role: { $in: ["admin", "companyAdmin", "manager"] },
      deleted: { $ne: true },
    }).select("_id");

    if (!admins.length) {
      console.log(`   ⚠️ No admins found for tenant ${tenantId}`);
      return [];
    }

    const notifications = admins.map((admin) => ({
      user: admin._id,
      tenant: tenantId,
      title,
      message,
      type,
      priority,
      reference,
      actionUrl,
      metadata,
      source: "system",
    }));

    const result = await Notification.createBatch(notifications);
    console.log(`   ✅ Notified ${result.length} admins`);

    return result;
  } catch (error) {
    console.error(`   ❌ Failed to notify admins:`, error.message);
    throw error;
  }
};

// ============================================================================
// NOTIFICATION RETRIEVAL
// ============================================================================

/**
 * Get notifications for a user with filters and pagination
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Paginated notifications
 */
exports.getNotifications = async ({
  userId,
  tenantId,
  status,
  type,
  priority,
  page = 1,
  limit = 20,
  sort = "-createdAt",
}) => {
  try {
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {
      user: userId,
      tenant: tenantId,
      deleted: false,
    };

    // ✅ FIX: Handle comma-separated status values
    if (status) {
      const statusArray = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statusArray.length === 1) {
        filter.status = statusArray[0];
      } else if (statusArray.length > 1) {
        filter.status = { $in: statusArray };
      }
    }

    // ✅ FIX: Handle comma-separated type values
    if (type) {
      const typeArray = type.split(',').map(t => t.trim()).filter(Boolean);
      if (typeArray.length === 1) {
        filter.type = typeArray[0];
      } else if (typeArray.length > 1) {
        filter.type = { $in: typeArray };
      }
    }

    // ✅ FIX: Handle comma-separated priority values
    if (priority) {
      const priorityArray = priority.split(',').map(p => p.trim()).filter(Boolean);
      if (priorityArray.length === 1) {
        filter.priority = priorityArray[0];
      } else if (priorityArray.length > 1) {
        filter.priority = { $in: priorityArray };
      }
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(filter),
      Notification.getUnreadCount(userId, tenantId),
    ]);

    return {
      notifications,
      total,
      unreadCount,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  } catch (error) {
    console.error(`❌ [NotificationService] getNotifications failed:`, error.message);
    throw error;
  }
};

/**
 * Get a single notification by ID
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<Object|null>} Notification or null
 */
exports.getNotificationById = async (notificationId, userId) => {
  try {
    const notification = await Notification.findOne({
      _id: notificationId,
      user: userId,
      deleted: false,
    });

    return notification;
  } catch (error) {
    console.error(`❌ [NotificationService] getNotificationById failed:`, error.message);
    throw error;
  }
};

/**
 * Get unread count for a user
 * @param {string} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<number} Unread count
 */
exports.getUnreadCount = async (userId, tenantId) => {
  return Notification.getUnreadCount(userId, tenantId);
};

// ============================================================================
// NOTIFICATION STATUS MANAGEMENT
// ============================================================================

/**
 * Mark a notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID (for ownership verification)
 * @returns {Promise<Object|null>} Updated notification
 */
exports.markAsRead = async (notificationId, userId) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: userId, deleted: false },
      { $set: { status: "read", readAt: new Date() } },
      { new: true }
    );

    if (notification) {
      console.log(`✅ [NotificationService] Marked as read: ${notificationId}`);
    }

    return notification;
  } catch (error) {
    console.error(`❌ [NotificationService] markAsRead failed:`, error.message);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Update result
 */
exports.markAllAsRead = async (userId, tenantId) => {
  try {
    const result = await Notification.markAllAsRead(userId, tenantId);

    console.log(`✅ [NotificationService] Marked all as read for user ${userId}: ${result.modifiedCount} updated`);

    return {
      success: true,
      modifiedCount: result.modifiedCount,
    };
  } catch (error) {
    console.error(`❌ [NotificationService] markAllAsRead failed:`, error.message);
    throw error;
  }
};

/**
 * Archive a notification
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Updated notification
 */
exports.archiveNotification = async (notificationId, userId) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: userId, deleted: false },
      { $set: { status: "archived" } },
      { new: true }
    );

    return notification;
  } catch (error) {
    console.error(`❌ [NotificationService] archiveNotification failed:`, error.message);
    throw error;
  }
};

// ============================================================================
// NOTIFICATION DELETION
// ============================================================================

/**
 * Soft delete a notification
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Deleted notification
 */
exports.deleteNotification = async (notificationId, userId) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: userId },
      { $set: { deleted: true } },
      { new: true }
    );

    if (notification) {
      console.log(`🗑️ [NotificationService] Deleted: ${notificationId}`);
      Logger.info("notification", "Notification deleted", {
        context: { notificationId, userId },
      });
    }

    return notification;
  } catch (error) {
    console.error(`❌ [NotificationService] deleteNotification failed:`, error.message);
    throw error;
  }
};

/**
 * Delete all notifications for a user (soft delete)
 * @param {string} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Delete result
 */
exports.deleteAllNotifications = async (userId, tenantId) => {
  try {
    const result = await Notification.updateMany(
      { user: userId, tenant: tenantId },
      { $set: { deleted: true } }
    );

    console.log(`🗑️ [NotificationService] Deleted all for user ${userId}: ${result.modifiedCount}`);

    return {
      success: true,
      deletedCount: result.modifiedCount,
    };
  } catch (error) {
    console.error(`❌ [NotificationService] deleteAllNotifications failed:`, error.message);
    throw error;
  }
};

// ============================================================================
// URGENT ACTION NOTIFICATIONS (Integration with Action Engine)
// ============================================================================

/**
 * Notify about an urgent action (called from postResponseProcessor)
 * @param {Object} action - Action document
 * @returns {Promise<void>}
 */
exports.notifyUrgentAction = async (action) => {
  try {
    const tenantId = action.tenant;
    console.log(`\n🚨 [NotificationService] Processing urgent action notification...`);
    console.log(`   Action: ${action._id}`);
    console.log(`   Title: ${action.title}`);
    console.log(`   Priority: ${action.priority}`);

    // 1. Check tenant notification settings
    const tenant = await Tenant.findById(tenantId);
    
    // ✅ FIX: Clearer logging - notifications are separate from action engine
    if (!tenant?.features?.notifications) {
      console.log(`   ℹ️ Notifications disabled for tenant ${tenantId}`);
      return { sent: false, reason: "notifications_disabled" };
    }

    // 2. Determine recipients - ONLY company admins of THIS tenant
    console.log(`   🔍 Finding company admin recipients...`);
    
    const recipients = [];

    // If action is assigned to specific user, notify them
    if (action.assignedTo) {
      recipients.push(action.assignedTo);
      console.log(`   → Added assignee: ${action.assignedTo}`);
    }

    // If action is assigned to team, get team members
    if (action.assignedToTeam) {
      const teamMembers = await User.find({
        tenant: tenantId,
        department: action.assignedToTeam,
        deleted: { $ne: true },
      }).select("_id");
      recipients.push(...teamMembers.map((m) => m._id));
      console.log(`   → Added ${teamMembers.length} team members`);
    }

    // ✅ FIX: If no assignee, notify ONLY companyAdmin (not all admins)
    if (recipients.length === 0) {
      const companyAdmins = await User.find({
        tenant: tenantId,
        role: "companyAdmin",  // Only company admins, not all admin roles
        deleted: { $ne: true },
      }).select("_id");
      
      recipients.push(...companyAdmins.map((a) => a._id));
      console.log(`   → Added ${companyAdmins.length} company admin(s)`);
    }

    // Remove duplicates
    const uniqueRecipients = [...new Set(recipients.map((r) => r.toString()))];

    if (uniqueRecipients.length === 0) {
      console.log(`   ⚠️ No recipients found for notification`);
      return { sent: false, reason: "no_recipients" };
    }

    console.log(`   📬 Sending to ${uniqueRecipients.length} recipient(s)`);

    // 3. Create in-app notifications
    const notifications = uniqueRecipients.map((userId) => ({
      user: userId,
      tenant: tenantId,
      title: `🚨 ${action.title}`,
      message: action.description?.substring(0, 200) || "Urgent action requires your attention",
      type: "alert",
      priority: action.priority === "high" ? "urgent" : "high",
      reference: { type: "Action", id: action._id },
      actionUrl: `/actions/${action._id}`,
      metadata: {
        actionId: action._id,
        category: action.category,
        dueDate: action.dueDate,
      },
      source: "action_engine",
    }));

    await Notification.insertMany(notifications);
    
    console.log(`   ✅ Notification sent to ${uniqueRecipients.length} user(s)`);
    
    return { sent: true, recipientCount: uniqueRecipients.length };

  } catch (error) {
    console.error(`   ❌ Notification failed:`, error.message);
    Logger.error("notification", "Urgent action notification failed", {
      error: error.message,
      context: { actionId: action._id },
    });
    return { sent: false, reason: error.message };
  }
};

// ============================================================================
// SURVEY NOTIFICATIONS
// ============================================================================

/**
 * Notify about a new survey response
 * @param {Object} params - Survey and response details
 */
exports.notifySurveyResponse = async ({ survey, response, tenantId }) => {
  try {
    // Notify survey creator
    if (survey.createdBy) {
      await this.createNotification({
        userId: survey.createdBy,
        tenantId,
        title: "New Survey Response",
        message: `Your survey "${survey.title}" received a new response`,
        type: "survey",
        priority: "medium",
        reference: { type: "SurveyResponse", id: response._id },
        actionUrl: `/surveys/${survey._id}/responses`,
        source: "system",
      });
    }
  } catch (error) {
    console.error(`❌ [NotificationService] notifySurveyResponse failed:`, error.message);
    // Non-fatal, don't throw
  }
};

/**
 * Notify about survey publication
 * @param {Object} params - Survey details
 */
exports.notifySurveyPublished = async ({ survey, tenantId, recipientCount }) => {
  try {
    if (survey.createdBy) {
      await this.createNotification({
        userId: survey.createdBy,
        tenantId,
        title: "Survey Published",
        message: `Your survey "${survey.title}" has been published to ${recipientCount} recipients`,
        type: "success",
        priority: "medium",
        reference: { type: "Survey", id: survey._id },
        actionUrl: `/surveys/${survey._id}`,
        source: "system",
      });
    }
  } catch (error) {
    console.error(`❌ [NotificationService] notifySurveyPublished failed:`, error.message);
  }
};

// ============================================================================
// CLEANUP & MAINTENANCE
// ============================================================================

/**
 * Clean up old notifications (for cron job)
 * @param {number} daysOld - Delete notifications older than this many days
 * @returns {Promise<Object>} Cleanup result
 */
exports.cleanupOldNotifications = async (daysOld = 90) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoffDate },
      status: { $in: ["read", "archived"] },
    });

    console.log(`🧹 [NotificationService] Cleaned up ${result.deletedCount} old notifications`);

    return {
      success: true,
      deletedCount: result.deletedCount,
    };
  } catch (error) {
    console.error(`❌ [NotificationService] Cleanup failed:`, error.message);
    throw error;
  }
};