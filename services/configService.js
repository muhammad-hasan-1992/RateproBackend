/**
 * Configuration Service
 * 
 * Centralized configuration management with encrypted DB storage,
 * environment variable fallback, and in-memory TTL caching.
 * 
 * Priority Chain:
 *   Sensitive keys:     Cache → DB → ENV → THROW (no hardcoded default)
 *   Non-sensitive keys: Cache → DB → ENV → Hardcoded default (acceptable)
 * 
 * Caching Strategy:
 *   - Per-key in-memory cache with configurable TTL (default 5 min)
 *   - Cache is invalidated on setConfig / deleteConfig
 *   - Cache persists until process restart or TTL expiry
 *   - No external dependency (no Redis required for config cache)
 * 
 * Usage:
 *   const configService = require("./configService");
 *   const apiKey = await configService.getConfig("SENDGRID_API_KEY");
 *   await configService.setConfig("SENDGRID_API_KEY", "SG.xxx", { encrypted: true, sensitive: true, category: "email" }, userId);
 */

const SystemConfig = require("../models/SystemConfig");
const TenantConfig = require("../models/TenantConfig");
const { encrypt, decrypt, maskValue } = require("../utils/encryption");
const Logger = require("../utils/logger");

// ============================================
// IN-MEMORY CACHE (per-key TTL)
// ============================================

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Simple in-memory cache with per-key TTL.
 * Keys are cached after first DB lookup to avoid repeated queries.
 * Cache is invalidated when a config is set or deleted.
 */
const _cache = new Map(); // key → { value, expiresAt }

const cacheGet = (cacheKey) => {
    const entry = _cache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        _cache.delete(cacheKey);
        return undefined;
    }
    return entry.value;
};

const cacheSet = (cacheKey, value, ttlMs = DEFAULT_CACHE_TTL_MS) => {
    _cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
};

const cacheInvalidate = (cacheKey) => {
    _cache.delete(cacheKey);
};

// ============================================
// SYSTEM CONFIG (Platform-Level)
// ============================================

/**
 * Get a system config value by key.
 * Checks cache → DB → ENV → throw/default.
 * 
 * @param {string} key - Config key name (e.g. "SENDGRID_API_KEY")
 * @param {object} [options]
 * @param {boolean} [options.sensitive=false] - If true, throws when value is missing
 * @param {*} [options.defaultValue] - Default for non-sensitive keys only
 * @returns {Promise<*>} The config value
 */
const getConfig = async (key, options = {}) => {
    const { sensitive = false, defaultValue = undefined } = options;

    try {
        // 1. Check in-memory cache first
        const cachedValue = cacheGet(`sys:${key}`);
        if (cachedValue !== undefined) {
            return cachedValue;
        }

        // 2. Check DB
        const dbConfig = await SystemConfig.findOne({ key });
        if (dbConfig) {
            const resolved = dbConfig.encrypted ? decrypt(dbConfig.value) : dbConfig.value;
            cacheSet(`sys:${key}`, resolved);
            return resolved;
        }

        // 3. Fallback to environment variable
        const envValue = process.env[key];
        if (envValue !== undefined && envValue !== "") {
            cacheSet(`sys:${key}`, envValue);
            return envValue;
        }

        // 4. Sensitive keys: NO hardcoded default → throw
        if (sensitive) {
            throw new Error(
                `Required sensitive config '${key}' is not set in DB or environment. ` +
                `Set it via the admin panel or add ${key} to your .env file.`
            );
        }

        // 5. Non-sensitive keys: return hardcoded default if provided
        if (defaultValue !== undefined) {
            cacheSet(`sys:${key}`, defaultValue);
        }
        return defaultValue;
    } catch (error) {
        if (error.message.includes("Required sensitive config")) {
            throw error; // Re-throw missing-config errors
        }
        Logger.error("configService.getConfig", `Failed to retrieve config: ${key}`, { error });
        if (sensitive) throw error;
        return defaultValue;
    }
};

/**
 * Set a system config value.
 * Encrypts the value if `encrypted` option is true.
 * Invalidates cache for the key.
 * 
 * @param {string} key - Config key
 * @param {*} value - Config value (will be encrypted if specified)
 * @param {object} meta
 * @param {boolean} [meta.encrypted=false]
 * @param {boolean} [meta.sensitive=false]
 * @param {string} meta.category
 * @param {string} [meta.label]
 * @param {string} [meta.description]
 * @param {string} userId - ID of the user making the change
 * @returns {Promise<object>} The saved config document
 */
const setConfig = async (key, value, meta = {}, userId = null) => {
    const {
        encrypted = false,
        sensitive = false,
        category = "general",
        label,
        description,
    } = meta;

    const storedValue = encrypted ? encrypt(String(value)) : value;

    const config = await SystemConfig.findOneAndUpdate(
        { key },
        {
            key,
            value: storedValue,
            encrypted,
            sensitive,
            category,
            ...(label && { label }),
            ...(description && { description }),
            updatedBy: userId,
        },
        { upsert: true, new: true, runValidators: true }
    );

    // Invalidate cache — next read will pick up new value
    cacheInvalidate(`sys:${key}`);

    Logger.info("configService.setConfig", `Config '${key}' updated`, {
        category,
        encrypted,
        updatedBy: userId,
    });

    return config;
};

/**
 * Get all system configs for a category.
 * Sensitive/encrypted values are masked in the response.
 */
const getConfigsByCategory = async (category) => {
    const configs = await SystemConfig.find({ category }).lean();

    return configs.map((config) => {
        let displayValue = config.value;

        if (config.encrypted) {
            try {
                const decrypted = decrypt(config.value);
                displayValue = maskValue(decrypted);
            } catch {
                displayValue = "***decryption-error***";
            }
        } else if (config.sensitive) {
            displayValue = maskValue(String(config.value));
        }

        return {
            _id: config._id,
            key: config.key,
            value: displayValue,
            encrypted: config.encrypted,
            sensitive: config.sensitive,
            category: config.category,
            label: config.label,
            description: config.description,
            updatedAt: config.updatedAt,
        };
    });
};

/**
 * Get all system configs (all categories), with masked values.
 */
const getAllConfigs = async () => {
    const configs = await SystemConfig.find({}).lean();

    return configs.map((config) => {
        let displayValue = config.value;

        if (config.encrypted) {
            try {
                const decrypted = decrypt(config.value);
                displayValue = maskValue(decrypted);
            } catch {
                displayValue = "***decryption-error***";
            }
        } else if (config.sensitive) {
            displayValue = maskValue(String(config.value));
        }

        return {
            _id: config._id,
            key: config.key,
            value: displayValue,
            encrypted: config.encrypted,
            sensitive: config.sensitive,
            category: config.category,
            label: config.label,
            description: config.description,
            updatedAt: config.updatedAt,
        };
    });
};

/**
 * Delete a system config (reset to ENV fallback).
 * Invalidates cache for the key.
 */
const deleteConfig = async (key, userId) => {
    const result = await SystemConfig.findOneAndDelete({ key });

    // Always invalidate cache, even if nothing was deleted
    cacheInvalidate(`sys:${key}`);

    if (result) {
        Logger.info("configService.deleteConfig", `Config '${key}' deleted (reset to ENV)`, {
            deletedBy: userId,
        });
    }

    return !!result;
};

// ============================================
// TENANT CONFIG (Tenant-Level)
// ============================================

/**
 * Get a tenant config value (with cache).
 */
const getTenantConfig = async (tenantId, key, defaultValue = undefined) => {
    const cacheKey = `tenant:${tenantId}:${key}`;
    const cachedValue = cacheGet(cacheKey);
    if (cachedValue !== undefined) return cachedValue;

    const config = await TenantConfig.findOne({ tenant: tenantId, key });
    if (config) {
        const resolved = config.encrypted ? decrypt(config.value) : config.value;
        cacheSet(cacheKey, resolved);
        return resolved;
    }

    if (defaultValue !== undefined) {
        cacheSet(cacheKey, defaultValue);
    }
    return defaultValue;
};

/**
 * Set a tenant config value. Invalidates cache.
 */
const setTenantConfig = async (tenantId, key, value, meta = {}, userId = null) => {
    const { encrypted = false, category = "general" } = meta;
    const storedValue = encrypted ? encrypt(String(value)) : value;

    const config = await TenantConfig.findOneAndUpdate(
        { tenant: tenantId, key },
        {
            tenant: tenantId,
            key,
            value: storedValue,
            encrypted,
            category,
            updatedBy: userId,
        },
        { upsert: true, new: true, runValidators: true }
    );

    cacheInvalidate(`tenant:${tenantId}:${key}`);

    return config;
};

/**
 * Get all tenant configs for a category.
 */
const getTenantConfigsByCategory = async (tenantId, category) => {
    return TenantConfig.find({ tenant: tenantId, category }).lean();
};

/**
 * Bulk set multiple tenant configs at once. Invalidates cache per key.
 */
const setTenantConfigBulk = async (tenantId, configMap, category, userId) => {
    const operations = Object.entries(configMap).map(([key, value]) => ({
        updateOne: {
            filter: { tenant: tenantId, key },
            update: {
                tenant: tenantId,
                key,
                value,
                category,
                updatedBy: userId,
            },
            upsert: true,
        },
    }));

    await TenantConfig.bulkWrite(operations);

    // Invalidate cache for all updated keys
    for (const key of Object.keys(configMap)) {
        cacheInvalidate(`tenant:${tenantId}:${key}`);
    }

    return TenantConfig.find({ tenant: tenantId, category }).lean();
};

module.exports = {
    // System-level
    getConfig,
    setConfig,
    getConfigsByCategory,
    getAllConfigs,
    deleteConfig,
    // Tenant-level
    getTenantConfig,
    setTenantConfig,
    getTenantConfigsByCategory,
    setTenantConfigBulk,
};
