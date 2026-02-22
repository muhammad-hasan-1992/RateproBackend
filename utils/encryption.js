/**
 * Encryption Utility
 * 
 * AES-256-GCM encryption/decryption for storing sensitive configuration
 * values in the database (API keys, tokens, credentials).
 * 
 * Requires CONFIG_ENCRYPTION_KEY in environment (32-byte hex string = 64 hex chars).
 * This is an infrastructure-level secret — NEVER admin-editable.
 * 
 * Usage:
 *   const { encrypt, decrypt } = require("./encryption");
 *   const encrypted = encrypt("sk-my-api-key");     // → { iv, authTag, ciphertext }
 *   const decrypted = decrypt(encrypted);             // → "sk-my-api-key"
 * 
 * ⚠️ KEY ROTATION:
 *   Changing CONFIG_ENCRYPTION_KEY will make ALL existing encrypted DB values
 *   undecryptable. Key rotation requires a migration script:
 * 
 *   1. Set OLD_CONFIG_ENCRYPTION_KEY=<old_key> and CONFIG_ENCRYPTION_KEY=<new_key>
 *   2. Run: node scripts/rotate-encryption-key.js
 *      (Script reads all encrypted SystemConfig docs, decrypts with old key,
 *       re-encrypts with new key, saves back)
 *   3. Remove OLD_CONFIG_ENCRYPTION_KEY from env
 *   4. Verify all encrypted configs are readable
 * 
 *   This is a breaking change if done without migration.
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;  // 128-bit IV
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment.
 * Throws immediately if missing — this is infrastructure-critical.
 */
const getEncryptionKey = () => {
    const key = process.env.CONFIG_ENCRYPTION_KEY;
    if (!key) {
        throw new Error(
            "CONFIG_ENCRYPTION_KEY is required but not set. " +
            "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }
    if (key.length !== 64) {
        throw new Error(
            "CONFIG_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
            `Current length: ${key.length}`
        );
    }
    return Buffer.from(key, "hex");
};

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext - The value to encrypt
 * @returns {{ iv: string, authTag: string, ciphertext: string }} - Hex-encoded components
 */
const encrypt = (plaintext) => {
    if (plaintext === null || plaintext === undefined) {
        throw new Error("Cannot encrypt null or undefined value");
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let ciphertext = cipher.update(String(plaintext), "utf8", "hex");
    ciphertext += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return {
        iv: iv.toString("hex"),
        authTag,
        ciphertext,
    };
};

/**
 * Decrypt an encrypted value.
 * @param {{ iv: string, authTag: string, ciphertext: string }} encryptedData
 * @returns {string} - The original plaintext
 */
const decrypt = (encryptedData) => {
    if (!encryptedData || !encryptedData.iv || !encryptedData.authTag || !encryptedData.ciphertext) {
        throw new Error("Invalid encrypted data: must contain iv, authTag, and ciphertext");
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(encryptedData.iv, "hex");
    const authTag = Buffer.from(encryptedData.authTag, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(encryptedData.ciphertext, "hex", "utf8");
    plaintext += decipher.final("utf8");

    return plaintext;
};

/**
 * Mask a sensitive value for safe API responses.
 * Shows first 4 and last 4 characters only.
 * @param {string} value - The plaintext value to mask
 * @returns {string} - Masked string, e.g. "sk-a...xyz9"
 */
const maskValue = (value) => {
    if (!value || typeof value !== "string") return "***";
    if (value.length <= 8) return "***";
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
};

module.exports = { encrypt, decrypt, maskValue };
