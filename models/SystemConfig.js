/**
 * SystemConfig Model
 * 
 * Platform-level configuration storage.
 * Stores business/integration keys (SendGrid, Twilio, AI, etc.)
 * with optional AES-256-GCM encryption for sensitive values.
 * 
 * Access: System Admin only (platform scope)
 * Priority: DB value → ENV fallback → throw (sensitive) / hardcoded default (non-sensitive)
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;

const systemConfigSchema = new Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        value: {
            type: Schema.Types.Mixed,
            required: true,
        },
        encrypted: {
            type: Boolean,
            default: false,
        },
        sensitive: {
            type: Boolean,
            default: false,
        },
        category: {
            type: String,
            enum: ["email", "sms", "whatsapp", "ai", "general", "feature_flags"],
            required: true,
        },
        label: {
            type: String,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// Category-based queries
systemConfigSchema.index({ category: 1 });

module.exports = mongoose.model("SystemConfig", systemConfigSchema);
