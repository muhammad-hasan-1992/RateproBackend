/**
 * TenantConfig Model
 * 
 * Tenant-scoped configuration storage.
 * Stores per-tenant settings: theme, notification preferences, 
 * general tenant-level configurations.
 * 
 * Access: CompanyAdmin (own tenant only)
 * Compound unique index: { tenant, key } — each tenant has its own config namespace.
 */

const mongoose = require("mongoose");
const { Schema } = mongoose;

const tenantConfigSchema = new Schema(
    {
        tenant: {
            type: Schema.Types.ObjectId,
            ref: "Tenant",
            required: true,
        },
        key: {
            type: String,
            required: true,
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
        category: {
            type: String,
            enum: ["theme", "notifications", "general"],
            required: true,
        },
        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// Each tenant has unique keys
tenantConfigSchema.index({ tenant: 1, key: 1 }, { unique: true });

// Fast category lookups per tenant
tenantConfigSchema.index({ tenant: 1, category: 1 });

module.exports = mongoose.model("TenantConfig", tenantConfigSchema);
