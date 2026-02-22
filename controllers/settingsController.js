/**
 * Settings Controller
 * 
 * Handles General Settings, Theme Settings, and Notification Preferences.
 * 
 * Access Control:
 *   General Settings:      Platform scope — admin only
 *   Theme Settings:        Tenant scope — companyAdmin only
 *   Notification Prefs:    Shared — all authenticated users (per-user)
 */

const configService = require("../services/configService");
const User = require("../models/User");

// ============================================
// GENERAL SETTINGS (Platform-Level)
// ============================================

// Default values for general settings (non-sensitive, safe to hardcode)
const GENERAL_DEFAULTS = {
    siteName: "RatePro",
    siteDescription: "Customer Experience Management Platform",
    timezone: "UTC",
    language: "en",
    dateFormat: "MM/DD/YYYY",
    currency: "USD",
    autoSave: true,
    sessionTimeout: 30,
};

/**
 * GET /api/settings/general
 * Get general platform settings
 */
const getGeneralSettings = async (req, res) => {
    try {
        const settings = {};

        for (const [key, defaultValue] of Object.entries(GENERAL_DEFAULTS)) {
            const configKey = `GENERAL_${key.toUpperCase()}`;
            settings[key] = await configService.getConfig(configKey, {
                sensitive: false,
                defaultValue,
            });
        }

        res.json({
            success: true,
            data: settings,
        });
    } catch (error) {
        console.error("Error fetching general settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve general settings",
        });
    }
};

/**
 * PUT /api/settings/general
 * Update general platform settings
 */
const updateGeneralSettings = async (req, res) => {
    try {
        const allowedKeys = Object.keys(GENERAL_DEFAULTS);
        const updates = {};

        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                const configKey = `GENERAL_${key.toUpperCase()}`;
                await configService.setConfig(
                    configKey,
                    req.body[key],
                    { encrypted: false, sensitive: false, category: "general", label: key },
                    req.user._id
                );
                updates[key] = req.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid settings fields provided",
            });
        }

        res.json({
            success: true,
            message: "General settings updated successfully",
            data: updates,
        });
    } catch (error) {
        console.error("Error updating general settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update general settings",
        });
    }
};

/**
 * POST /api/settings/general/reset
 * Reset general settings to defaults (delete DB entries)
 */
const resetGeneralSettings = async (req, res) => {
    try {
        for (const key of Object.keys(GENERAL_DEFAULTS)) {
            const configKey = `GENERAL_${key.toUpperCase()}`;
            await configService.deleteConfig(configKey, req.user._id);
        }

        res.json({
            success: true,
            message: "General settings reset to defaults",
            data: GENERAL_DEFAULTS,
        });
    } catch (error) {
        console.error("Error resetting general settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to reset general settings",
        });
    }
};

// ============================================
// THEME SETTINGS (Tenant-Level)
// ============================================

const THEME_DEFAULTS = {
    primaryColor: "#6366f1",
    secondaryColor: "#8b5cf6",
    logoUrl: "",
    darkMode: false,
};

/**
 * GET /api/settings/theme
 * Get tenant theme settings
 */
const getThemeSettings = async (req, res) => {
    try {
        // SECURITY: Tenant ID from auth middleware only — never from body/params
        //           This prevents cross-tenant data access.
        const tenantId = req.user.tenant;
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                message: "Tenant context required for theme settings",
            });
        }

        const settings = {};
        for (const [key, defaultValue] of Object.entries(THEME_DEFAULTS)) {
            settings[key] = await configService.getTenantConfig(
                tenantId,
                `THEME_${key.toUpperCase()}`,
                defaultValue
            );
        }

        res.json({
            success: true,
            data: settings,
        });
    } catch (error) {
        console.error("Error fetching theme settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve theme settings",
        });
    }
};

/**
 * PUT /api/settings/theme
 * Update tenant theme settings
 */
const updateThemeSettings = async (req, res) => {
    try {
        // SECURITY: Tenant ID from auth middleware only — never from body/params
        const tenantId = req.user.tenant;
        if (!tenantId) {
            return res.status(400).json({
                success: false,
                message: "Tenant context required for theme settings",
            });
        }

        const allowedKeys = Object.keys(THEME_DEFAULTS);
        const updates = {};

        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                await configService.setTenantConfig(
                    tenantId,
                    `THEME_${key.toUpperCase()}`,
                    req.body[key],
                    { category: "theme" },
                    req.user._id
                );
                updates[key] = req.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid theme settings provided",
            });
        }

        res.json({
            success: true,
            message: "Theme settings updated successfully",
            data: updates,
        });
    } catch (error) {
        console.error("Error updating theme settings:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update theme settings",
        });
    }
};

// ============================================
// NOTIFICATION PREFERENCES (Per-User)
// ============================================

const NOTIFICATION_DEFAULTS = {
    inApp: true,
    email: true,
    actionAssigned: true,
    actionEscalated: true,
    actionOverdue: true,
    actionCompleted: true,
    surveyResponses: true,
    systemAlerts: true,
};

/**
 * GET /api/settings/notifications
 * Get current user's notification preferences
 */
const getNotificationPreferences = async (req, res) => {
    try {
        // SECURITY: Always uses req.user._id from auth middleware.
        //           Never accepts userId from body/params to prevent privilege escalation.
        const user = await User.findById(req.user._id).select("notificationPreferences").lean();
        const prefs = user?.notificationPreferences || {};

        // Merge with defaults (user prefs override defaults)
        const settings = { ...NOTIFICATION_DEFAULTS, ...prefs };

        res.json({
            success: true,
            data: settings,
        });
    } catch (error) {
        console.error("Error fetching notification preferences:", error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve notification preferences",
        });
    }
};

/**
 * PUT /api/settings/notifications
 * Update current user's notification preferences
 */
const updateNotificationPreferences = async (req, res) => {
    try {
        const allowedKeys = Object.keys(NOTIFICATION_DEFAULTS);
        const updates = {};

        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                if (typeof req.body[key] !== "boolean") {
                    return res.status(400).json({
                        success: false,
                        message: `'${key}' must be a boolean value`,
                    });
                }
                updates[key] = req.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid notification preferences provided",
            });
        }

        // SECURITY: Uses req.user._id — admin cannot modify another user's preferences
        const setFields = {};
        for (const [key, value] of Object.entries(updates)) {
            setFields[`notificationPreferences.${key}`] = value;
        }

        await User.findByIdAndUpdate(req.user._id, { $set: setFields });

        res.json({
            success: true,
            message: "Notification preferences updated successfully",
            data: updates,
        });
    } catch (error) {
        console.error("Error updating notification preferences:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update notification preferences",
        });
    }
};

module.exports = {
    // General Settings
    getGeneralSettings,
    updateGeneralSettings,
    resetGeneralSettings,
    // Theme Settings
    getThemeSettings,
    updateThemeSettings,
    // Notification Preferences
    getNotificationPreferences,
    updateNotificationPreferences,
};
