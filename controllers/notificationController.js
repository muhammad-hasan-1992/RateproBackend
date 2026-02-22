// controllers/notificationController.js
const notificationService = require("../services/notifications/notificationService");
const Logger = require("../utils/auditLog");
const mongoose = require("mongoose");

// ============================================================================
// CREATE NOTIFICATION
// ============================================================================

/**
 * POST /api/notifications
 * Create a new notification
 */
exports.createNotification = async (req, res, next) => {
  try {
    const { userId, title, message, type, priority, reference, actionUrl, metadata, expiresAt } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "title and message are required",
      });
    }

    // Validate userId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId format",
      });
    }

    // 🔐 tenantId is server-determined for scope — admin = null (platform), others = tenant
    const tenantId = req.user.role === "admin" ? null : (req.tenantId || req.user.tenant);

    const notification = await notificationService.createNotification({
      userId,
      tenantId,
      title,
      message,
      type,
      priority,
      reference,
      actionUrl,
      metadata,
      expiresAt,
      source: "api",
    });

    res.status(201).json({
      success: true,
      message: "Notification created successfully",
      data: notification,
    });
  } catch (err) {
    Logger.error("notificationController", "Error creating notification", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * POST /api/notifications/batch
 * Create multiple notifications at once
 */
exports.createBatchNotifications = async (req, res, next) => {
  try {
    const { notifications } = req.body;

    if (!notifications || !Array.isArray(notifications) || notifications.length === 0) {
      return res.status(400).json({
        success: false,
        message: "notifications array is required and must not be empty",
      });
    }

    // Add tenant and scope to each notification
    const tenantId = req.tenantId || req.user.tenant;
    const enrichedNotifications = notifications.map((n) => ({
      ...n,
      scope: "tenant",
      tenant: tenantId,
      source: "api",
    }));

    const result = await notificationService.createBatchNotifications(enrichedNotifications);

    res.status(201).json({
      success: true,
      message: `${result.insertedCount} notifications created`,
      data: result,
    });
  } catch (err) {
    Logger.error("notificationController", "Error creating batch notifications", {
      error: err,
      req,
    });
    next(err);
  }
};

// ============================================================================
// GET NOTIFICATIONS
// ============================================================================

/**
 * GET /api/notifications
 * Get current user's notifications with filters and pagination
 */
exports.getMyNotifications = async (req, res, next) => {
  try {
    const { status, type, priority, page, limit, sort } = req.query;

    const result = await notificationService.getNotifications({
      userId: req.user._id,
      userRole: req.user.role,
      tenantId: req.tenantId || req.user.tenant,
      status,
      type,
      priority,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sort: sort || "-createdAt",
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    Logger.error("notificationController", "Error fetching notifications", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * GET /api/notifications/:userId
 * Get notifications for a specific user (admin only)
 */
exports.getNotificationsByUserId = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status, type, priority, page, limit, sort } = req.query;

    // Validate userId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId format",
      });
    }

    const result = await notificationService.getNotifications({
      userId,
      userRole: req.user.role,
      tenantId: req.tenantId || req.user.tenant,
      status,
      type,
      priority,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sort: sort || "-createdAt",
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    Logger.error("notificationController", "Error fetching user notifications", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * GET /api/notifications/:id
 * Get a single notification by ID
 */
exports.getNotificationById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    const notification = await notificationService.getNotificationById(id, req.user._id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (err) {
    Logger.error("notificationController", "Error fetching notification", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * GET /api/notifications/unread/count
 * Get unread notification count for current user
 */
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await notificationService.getUnreadCount(
      req.user._id,
      req.user.role,
      req.tenantId || req.user.tenant
    );

    res.status(200).json({
      success: true,
      data: { unreadCount: count },
    });
  } catch (err) {
    Logger.error("notificationController", "Error fetching unread count", {
      error: err,
      req,
    });
    next(err);
  }
};

// ============================================================================
// UPDATE NOTIFICATIONS
// ============================================================================

/**
 * PATCH /api/notifications/:id/read
 * Mark a notification as read
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    const notification = await notificationService.markAsRead(id, req.user._id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  } catch (err) {
    Logger.error("notificationController", "Error marking notification as read", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read for current user
 */
exports.markAllAsRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllAsRead(
      req.user._id,
      req.user.role,
      req.tenantId || req.user.tenant
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: result,
    });
  } catch (err) {
    Logger.error("notificationController", "Error marking all as read", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * PATCH /api/notifications/:id/archive
 * Archive a notification
 */
exports.archiveNotification = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    const notification = await notificationService.archiveNotification(id, req.user._id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification archived",
      data: notification,
    });
  } catch (err) {
    Logger.error("notificationController", "Error archiving notification", {
      error: err,
      req,
    });
    next(err);
  }
};

// ============================================================================
// DELETE NOTIFICATIONS
// ============================================================================

/**
 * DELETE /api/notifications/:id
 * Delete a notification (soft delete)
 */
exports.deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID format",
      });
    }

    const notification = await notificationService.deleteNotification(id, req.user._id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted",
      data: { id: notification._id },
    });
  } catch (err) {
    Logger.error("notificationController", "Error deleting notification", {
      error: err,
      req,
    });
    next(err);
  }
};

/**
 * DELETE /api/notifications
 * Delete all notifications for current user
 */
exports.deleteAllNotifications = async (req, res, next) => {
  try {
    const result = await notificationService.deleteAllNotifications(
      req.user._id,
      req.user.role,
      req.tenantId || req.user.tenant
    );

    res.status(200).json({
      success: true,
      message: `${result.deletedCount} notifications deleted`,
      data: result,
    });
  } catch (err) {
    Logger.error("notificationController", "Error deleting all notifications", {
      error: err,
      req,
    });
    next(err);
  }
};