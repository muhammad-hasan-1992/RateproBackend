/**
 * DropdownOption Model
 * 
 * System-level configuration for all dropdown options in the application.
 * These are GLOBAL options managed exclusively by System Admin.
 * 
 * Ownership: System Admin only (CRUD)
 * Access: All authenticated users (read-only)
 */

const mongoose = require("mongoose");

const dropdownOptionSchema = new mongoose.Schema(
    {
        // Type of dropdown (e.g., 'industry', 'survey_category', 'target_audience')
        type: {
            type: String,
            required: [true, "Dropdown type is required"],
            trim: true,
            lowercase: true,
            enum: {
                values: [
                    "industry",
                    "survey_category",
                    "target_audience",
                    "ticket_category",
                    "priority"
                ],
                message: "Invalid dropdown type: {VALUE}"
            },
            index: true
        },

        // Unique key for this option (used in code/database)
        key: {
            type: String,
            required: [true, "Option key is required"],
            trim: true,
            lowercase: true,
            match: [/^[a-z0-9_]+$/, "Key must be lowercase alphanumeric with underscores only"]
        },

        // Display label shown to users
        label: {
            type: String,
            required: [true, "Option label is required"],
            trim: true,
            maxlength: [100, "Label cannot exceed 100 characters"]
        },

        // Optional description
        description: {
            type: String,
            trim: true,
            maxlength: [500, "Description cannot exceed 500 characters"]
        },

        // Optional color for UI display (hex format)
        color: {
            type: String,
            trim: true,
            default: "#6c757d",
            match: [/^#[0-9A-Fa-f]{6}$/, "Color must be a valid hex color"]
        },

        // Sort order for display
        sortOrder: {
            type: Number,
            default: 0
        },

        // Soft delete flag
        active: {
            type: Boolean,
            default: true,
            index: true
        },

        // Audit fields
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    },
    {
        timestamps: true
    }
);

// Compound unique index: type + key must be unique
dropdownOptionSchema.index(
    { type: 1, key: 1 },
    {
        unique: true,
        partialFilterExpression: { active: true }
    }
);

// Index for efficient querying
dropdownOptionSchema.index({ type: 1, active: 1, sortOrder: 1 });

/**
 * Get all active options for a dropdown type
 * @param {string} type - The dropdown type
 * @returns {Promise<Array>} Array of options sorted by sortOrder
 */
dropdownOptionSchema.statics.getOptions = async function (type) {
    return this.find({ type, active: true })
        .sort({ sortOrder: 1, label: 1 })
        .select("key label description color sortOrder")
        .lean();
};

/**
 * Get all dropdown types with their counts
 * @returns {Promise<Array>} Array of { type, count }
 */
dropdownOptionSchema.statics.getTypeCounts = async function () {
    return this.aggregate([
        { $match: { active: true } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
        { $project: { type: "$_id", count: 1, _id: 0 } },
        { $sort: { type: 1 } }
    ]);
};

const DropdownOption = mongoose.model("DropdownOption", dropdownOptionSchema);

module.exports = DropdownOption;
