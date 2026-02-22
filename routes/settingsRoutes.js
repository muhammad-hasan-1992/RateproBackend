/**
 * Settings Routes
 * 
 * API endpoints for General Settings, Theme Settings, and Notification Preferences.
 * 
 * Access Control:
 *   /general/*          → Platform scope, admin only
 *   /theme/*            → Tenant scope, companyAdmin only
 *   /notifications/*    → Shared, all authenticated users
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { enforcePlatformScope } = require("../middlewares/scopeMiddleware");

const {
    getGeneralSettings,
    updateGeneralSettings,
    resetGeneralSettings,
    getThemeSettings,
    updateThemeSettings,
    getNotificationPreferences,
    updateNotificationPreferences,
} = require("../controllers/settingsController");

// All routes require authentication
router.use(protect);

// ============================================
// GENERAL SETTINGS — Platform scope, admin only
// ============================================

router.get(
    "/general",
    allowRoles("admin"),
    enforcePlatformScope,
    getGeneralSettings
);

router.put(
    "/general",
    allowRoles("admin"),
    enforcePlatformScope,
    updateGeneralSettings
);

router.post(
    "/general/reset",
    allowRoles("admin"),
    enforcePlatformScope,
    resetGeneralSettings
);

// ============================================
// THEME SETTINGS — Tenant scope, companyAdmin only
// ============================================

router.get(
    "/theme",
    allowRoles("companyAdmin"),
    getThemeSettings
);

router.put(
    "/theme",
    allowRoles("companyAdmin"),
    updateThemeSettings
);

// ============================================
// NOTIFICATION PREFERENCES — All authenticated users
// ============================================

router.get(
    "/notifications",
    allowRoles("admin", "companyAdmin", "member"),
    getNotificationPreferences
);

router.put(
    "/notifications",
    allowRoles("admin", "companyAdmin", "member"),
    updateNotificationPreferences
);

module.exports = router;
