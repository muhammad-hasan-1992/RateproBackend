// models/WhatsAppSetting.js
//
// WhatsApp configuration per tenant.
// Sensitive credentials (accountSid, authToken, accessToken) are
// encrypted at rest using AES-256-GCM via pre-save hooks.
// Decrypted transparently on read via post-find hooks.

const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

// Fields that contain secrets and must be encrypted at rest
const SENSITIVE_FIELDS = [
  'twilio.accountSid',
  'twilio.authToken',
  'meta.accessToken',
];

/**
 * Helper: get a nested value from an object using dot notation
 */
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
};

/**
 * Helper: set a nested value using dot notation
 */
const setNestedValue = (obj, path, value) => {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
};

/**
 * Check if a value is already in encrypted format ({ iv, authTag, ciphertext })
 */
const isEncryptedObject = (value) => {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.iv === 'string' &&
    typeof value.authTag === 'string' &&
    typeof value.ciphertext === 'string'
  );
};


const whatsappSettingSchema = new mongoose.Schema({
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
  provider: { type: String, enum: ['twilio', 'meta'], default: 'twilio' },
  // Twilio config (accountSid & authToken encrypted at rest)
  twilio: {
    accountSid: mongoose.Schema.Types.Mixed, // Stored as encrypted object
    authToken: mongoose.Schema.Types.Mixed,   // Stored as encrypted object
    fromNumber: String,
  },
  // Meta (WhatsApp Cloud API) config (accessToken encrypted at rest)
  meta: {
    phoneNumberId: String,
    accessToken: mongoose.Schema.Types.Mixed, // Stored as encrypted object
    fromNumber: String,
  },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });


// ============================================
// PRE-SAVE: Encrypt sensitive fields before writing to DB
// ============================================
whatsappSettingSchema.pre('save', function (next) {
  try {
    for (const fieldPath of SENSITIVE_FIELDS) {
      const value = getNestedValue(this.toObject(), fieldPath);
      // Only encrypt if it's a non-empty string (not already encrypted)
      if (value && typeof value === 'string' && value.trim() !== '') {
        const encrypted = encrypt(value);
        setNestedValue(this, fieldPath, encrypted);
        this.markModified(fieldPath);
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});


// ============================================
// HELPERS: Decrypt a document's sensitive fields
// ============================================

/**
 * Decrypt sensitive fields on a Mongoose document or plain object.
 * Called by post-find hooks and can be used in controllers.
 */
function decryptSensitiveFields(doc) {
  if (!doc) return doc;

  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;

  for (const fieldPath of SENSITIVE_FIELDS) {
    const value = getNestedValue(obj, fieldPath);
    if (isEncryptedObject(value)) {
      try {
        const decrypted = decrypt(value);
        setNestedValue(obj, fieldPath, decrypted);
      } catch {
        // If decryption fails, mask the value instead of exposing raw cipher
        setNestedValue(obj, fieldPath, '***decryption-error***');
      }
    }
  }

  return obj;
}


// ============================================
// POST-FIND HOOKS: Auto-decrypt on read
// ============================================

whatsappSettingSchema.post('findOne', function (doc) {
  if (doc) {
    const decrypted = decryptSensitiveFields(doc);
    // Copy decrypted values back onto the Mongoose document
    for (const fieldPath of SENSITIVE_FIELDS) {
      const value = getNestedValue(decrypted, fieldPath);
      if (value !== undefined) {
        setNestedValue(doc, fieldPath, value);
      }
    }
  }
});

whatsappSettingSchema.post('find', function (docs) {
  for (const doc of docs) {
    const decrypted = decryptSensitiveFields(doc);
    for (const fieldPath of SENSITIVE_FIELDS) {
      const value = getNestedValue(decrypted, fieldPath);
      if (value !== undefined) {
        setNestedValue(doc, fieldPath, value);
      }
    }
  }
});


module.exports = mongoose.model('WhatsAppSetting', whatsappSettingSchema);
