// routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { tenantCheck } = require("../middlewares/tenantMiddleware");

// Controller
const {
  createNotification,
  createBatchNotifications,
  getMyNotifications,
  getNotificationsByUserId,
  getNotificationById,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  deleteNotification,
  deleteAllNotifications,
} = require("../controllers/notificationController");

// ============================================================================
// 🔒 ALL ROUTES REQUIRE AUTHENTICATION
// ============================================================================
router.use(protect);

// ============================================================================
// Tenant Middleware
// ============================================================================
const setTenantId = (req, res, next) => {
  if (req.user.role === "admin") {
    return next();
  }
  if (!req.user.tenant) {
    return res.status(403).json({ message: "Access denied: No tenant associated with this user" });
  }
  req.tenantId = req.user.tenant._id
    ? req.user.tenant._id.toString()
    : req.user.tenant.toString();
  next();
};

router.use(setTenantId);

// ============================================================================
// USER ROUTES (Own notifications)
// ============================================================================

/**
 * @route   GET /api/notifications
 * @desc    Get current user's notifications
 * @access  Private
 * @query   status, type, priority, page, limit, sort
 */
router.get("/", getMyNotifications);

/**
 * @route   GET /api/notifications/unread/count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get("/unread/count", getUnreadCount);

/**
 * @route   PATCH /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.patch("/read-all", markAllAsRead);

/**
 * @route   DELETE /api/notifications
 * @desc    Delete all notifications for current user
 * @access  Private
 */
router.delete("/", deleteAllNotifications);

/**
 * @route   GET /api/notifications/:id
 * @desc    Get a single notification by ID
 * @access  Private
 */
router.get("/:id", getNotificationById);

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.patch("/:id/read", markAsRead);

/**
 * @route   PATCH /api/notifications/:id/archive
 * @desc    Archive a notification
 * @access  Private
 */
router.patch("/:id/archive", archiveNotification);

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a notification
 * @access  Private
 */
router.delete("/:id", deleteNotification);

// ============================================================================
// ADMIN ROUTES (Create & manage for other users)
// ============================================================================

/**
 * @route   POST /api/notifications
 * @desc    Create a notification (for any user)
 * @access  Private (Admin/Manager only)
 */
router.post("/", allowRoles("admin", "companyAdmin", "manager"), createNotification);

/**
 * @route   POST /api/notifications/batch
 * @desc    Create batch notifications
 * @access  Private (Admin/Manager only)
 */
router.post("/batch", allowRoles("admin", "companyAdmin", "manager"), createBatchNotifications);

/**
 * @route   GET /api/notifications/user/:userId
 * @desc    Get notifications for a specific user
 * @access  Private (Admin/Manager only)
 */
router.get("/user/:userId", allowRoles("admin", "companyAdmin", "manager"), getNotificationsByUserId);

module.exports = router;