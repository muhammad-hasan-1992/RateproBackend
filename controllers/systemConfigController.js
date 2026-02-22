/**
 * System Config Controller
 * 
 * Platform-level configuration CRUD for System Admins.
 * Manages business/integration keys (SendGrid, Twilio, AI, etc.)
 * 
 * All endpoints are platform-scoped and require admin role.
 * Sensitive values are always masked in responses.
 * 
 * SECURITY: Only whitelisted keys (CONFIG_REGISTRY) can be created/updated.
 * Arbitrary key creation is rejected to prevent system flag overrides.
 */

const configService = require("../services/configService");
const Logger = require("../utils/logger");

// ============================================
// CONFIG KEY REGISTRY (Whitelist)
// Only these keys can be created/updated via the admin panel.
// This prevents admins from creating arbitrary keys that could
// override internal system flags or break the application.
// ============================================

const CONFIG_REGISTRY = {
    // Email
    SENDGRID_API_KEY: { category: "email", encrypted: true, sensitive: true, label: "SendGrid API Key" },
    FROM_NAME: { category: "email", encrypted: false, sensitive: false, label: "Sender Display Name" },
    FROM_EMAIL: { category: "email", encrypted: false, sensitive: false, label: "Sender Email Address" },

    // SMS
    SMS_PROVIDER_SID: { category: "sms", encrypted: true, sensitive: true, label: "SMS Provider SID" },
    SMS_PROVIDER_AUTH_TOKEN: { category: "sms", encrypted: true, sensitive: true, label: "SMS Auth Token" },
    SMS_PROVIDER_NUMBER: { category: "sms", encrypted: false, sensitive: false, label: "SMS Sender Number" },

    // WhatsApp
    TWILIO_ACCOUNT_SID: { category: "whatsapp", encrypted: true, sensitive: true, label: "Twilio Account SID" },
    TWILIO_AUTH_TOKEN: { category: "whatsapp", encrypted: true, sensitive: true, label: "Twilio Auth Token" },
    TWILIO_WHATSAPP_FROM: { category: "whatsapp", encrypted: false, sensitive: false, label: "WhatsApp Sender Number" },
    META_WHATSAPP_PHONE_NUMBER_ID: { category: "whatsapp", encrypted: false, sensitive: false, label: "Meta Phone Number ID" },
    META_WHATSAPP_TOKEN: { category: "whatsapp", encrypted: true, sensitive: true, label: "Meta Access Token" },

    // AI
    GEMINI_API_KEY: { category: "ai", encrypted: true, sensitive: true, label: "Gemini AI API Key" },

    // Feature Flags
    ENABLE_QUEUES: { category: "feature_flags", encrypted: false, sensitive: false, label: "Enable Background Queues" },
};

/**
 * GET /api/platform/config
 * List all system configs (values masked for sensitive/encrypted keys)
 */
const listAllConfigs = async (req, res) => {
    try {
        const configs = await configService.getAllConfigs();

        // Also include unset registry keys so admin knows what's available
        const registeredKeys = Object.keys(CONFIG_REGISTRY);
        const existingKeys = configs.map((c) => c.key);
        const missingKeys = registeredKeys.filter((k) => !existingKeys.includes(k));

        const availableConfigs = missingKeys.map((key) => ({
            key,
            value: null,
            encrypted: CONFIG_REGISTRY[key].encrypted,
            sensitive: CONFIG_REGISTRY[key].sensitive,
            category: CONFIG_REGISTRY[key].category,
            label: CONFIG_REGISTRY[key].label,
            source: "not_set",
        }));

        res.json({
            success: true,
            data: [...configs, ...availableConfigs],
            count: configs.length + availableConfigs.length,
        });
    } catch (error) {
        console.error("Error listing configs:", error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve system configurations",
        });
    }
};

/**
 * GET /api/platform/config/:category
 * List configs filtered by category
 */
const listConfigsByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        const validCategories = ["email", "sms", "whatsapp", "ai", "general", "feature_flags"];

        if (!validCategories.includes(category)) {
            return res.status(400).json({
                success: false,
                message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
            });
        }

        const configs = await configService.getConfigsByCategory(category);

        // Include unset registry keys for this category
        const registeredInCategory = Object.entries(CONFIG_REGISTRY)
            .filter(([, meta]) => meta.category === category)
            .map(([key]) => key);
        const existingKeys = configs.map((c) => c.key);
        const missingKeys = registeredInCategory.filter((k) => !existingKeys.includes(k));

        const availableConfigs = missingKeys.map((key) => ({
            key,
            value: null,
            encrypted: CONFIG_REGISTRY[key].encrypted,
            sensitive: CONFIG_REGISTRY[key].sensitive,
            category: CONFIG_REGISTRY[key].category,
            label: CONFIG_REGISTRY[key].label,
            source: "not_set",
        }));

        res.json({
            success: true,
            data: [...configs, ...availableConfigs],
            category,
            count: configs.length + availableConfigs.length,
        });
    } catch (error) {
        console.error("Error listing configs by category:", error);
        res.status(500).json({
            success: false,
            message: "Failed to retrieve configurations",
        });
    }
};

/**
 * PUT /api/platform/config/:key
 * Create or update a system config value.
 * SECURITY: Only whitelisted keys from CONFIG_REGISTRY are accepted.
 */
const upsertConfig = async (req, res) => {
    try {
        const { key } = req.params;
        const { value } = req.body;

        if (!key || key.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Config key is required",
            });
        }

        // SECURITY: Validate against whitelist
        const registryEntry = CONFIG_REGISTRY[key.trim()];
        if (!registryEntry) {
            return res.status(400).json({
                success: false,
                message: `Unknown config key '${key}'. Only registered configuration keys can be set.`,
                allowedKeys: Object.keys(CONFIG_REGISTRY),
            });
        }

        if (value === undefined || value === null) {
            return res.status(400).json({
                success: false,
                message: "Config value is required",
            });
        }

        // Use registry-defined metadata (admin cannot override encrypted/sensitive/category)
        const config = await configService.setConfig(
            key.trim(),
            value,
            {
                encrypted: registryEntry.encrypted,
                sensitive: registryEntry.sensitive,
                category: registryEntry.category,
                label: registryEntry.label,
            },
            req.user._id
        );

        Logger.info("systemConfig.upsert", `Config '${key}' updated by admin`, {
            key,
            category: registryEntry.category,
            updatedBy: req.user._id,
        });

        res.json({
            success: true,
            message: `Configuration '${key}' updated successfully`,
            data: {
                key: config.key,
                category: config.category,
                encrypted: config.encrypted,
                sensitive: config.sensitive,
                updatedAt: config.updatedAt,
            },
        });
    } catch (error) {
        console.error("Error updating config:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update configuration",
        });
    }
};

/**
 * DELETE /api/platform/config/:key
 * Delete a config (reset to ENV fallback)
 */
const resetConfig = async (req, res) => {
    try {
        const { key } = req.params;

        const deleted = await configService.deleteConfig(key, req.user._id);

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: `Configuration '${key}' not found in database`,
            });
        }

        Logger.info("systemConfig.reset", `Config '${key}' reset to ENV default`, {
            key,
            deletedBy: req.user._id,
        });

        res.json({
            success: true,
            message: `Configuration '${key}' reset to environment default`,
        });
    } catch (error) {
        console.error("Error resetting config:", error);
        res.status(500).json({
            success: false,
            message: "Failed to reset configuration",
        });
    }
};

/**
 * POST /api/platform/config/test-email
 * Test email delivery using current config.
 * Rate limited: 3 requests per 5 minutes per admin.
 */
const testEmailConfig = async (req, res) => {
    try {
        const { recipientEmail } = req.body;

        if (!recipientEmail) {
            return res.status(400).json({
                success: false,
                message: "recipientEmail is required",
            });
        }

        Logger.info("systemConfig.testEmail", `Email test triggered`, {
            recipientEmail,
            triggeredBy: req.user._id,
        });

        const sendEmail = require("../utils/sendEmail");

        await sendEmail({
            to: recipientEmail,
            subject: "RatePro — Email Configuration Test",
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>✅ Email Configuration Test Successful</h2>
          <p>This confirms that your email configuration is working correctly.</p>
          <p><strong>Sent at:</strong> ${new Date().toISOString()}</p>
          <p><strong>Sent by:</strong> ${req.user?.name || "System Admin"}</p>
        </div>
      `,
        });

        res.json({
            success: true,
            message: `Test email sent to ${recipientEmail}. Check your inbox.`,
        });
    } catch (error) {
        console.error("Error testing email config:", error);
        res.status(500).json({
            success: false,
            message: `Email test failed: ${error.message}`,
        });
    }
};

module.exports = {
    listAllConfigs,
    listConfigsByCategory,
    upsertConfig,
    resetConfig,
    testEmailConfig,
};
