/**
 * Dropdown Settings Controller
 * 
 * Manages system-level dropdown options.
 * 
 * Access Control:
 * - CRUD operations: System Admin only (role === 'admin')
 * - Read operations: All authenticated users
 */

const DropdownOption = require("../models/DropdownOption");

/**
 * Middleware to check if user is System Admin
 */
const requireSystemAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Access denied. System Admin privileges required."
        });
    }
    next();
};

/**
 * GET /api/settings/dropdowns/types
 * Get all dropdown types with their option counts
 * Access: All authenticated users
 */
const getDropdownTypes = async (req, res) => {
    try {
        const types = await DropdownOption.getTypeCounts();

        res.json({
            success: true,
            types
        });
    } catch (error) {
        console.error("Error fetching dropdown types:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dropdown types"
        });
    }
};

/**
 * GET /api/settings/dropdowns/:type
 * Get all options for a specific dropdown type
 * Access: All authenticated users
 */
const getOptions = async (req, res) => {
    try {
        const { type } = req.params;

        const options = await DropdownOption.getOptions(type);

        res.json({
            success: true,
            type,
            options,
            count: options.length
        });
    } catch (error) {
        console.error("Error fetching dropdown options:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dropdown options"
        });
    }
};

/**
 * POST /api/settings/dropdowns
 * Create a new dropdown option
 * Access: System Admin only
 */
const createOption = async (req, res) => {
    try {
        const { type, key, label, description, color, sortOrder } = req.body;

        // Validate required fields
        if (!type || !key || !label) {
            return res.status(400).json({
                success: false,
                message: "Type, key, and label are required"
            });
        }

        // Check for duplicate
        const existing = await DropdownOption.findOne({
            type,
            key: key.toLowerCase(),
            active: true
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Option with key "${key}" already exists for type "${type}"`
            });
        }

        const option = await DropdownOption.create({
            type,
            key: key.toLowerCase(),
            label,
            description,
            color: color || "#6c757d",
            sortOrder: sortOrder || 0,
            createdBy: req.user._id
        });

        res.status(201).json({
            success: true,
            message: "Dropdown option created successfully",
            option
        });
    } catch (error) {
        console.error("Error creating dropdown option:", error);

        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: Object.values(error.errors).map(e => e.message).join(", ")
            });
        }

        res.status(500).json({
            success: false,
            message: "Failed to create dropdown option"
        });
    }
};

/**
 * PUT /api/settings/dropdowns/:id
 * Update an existing dropdown option
 * Access: System Admin only
 */
const updateOption = async (req, res) => {
    try {
        const { id } = req.params;
        const { label, description, color, sortOrder } = req.body;

        const option = await DropdownOption.findById(id);

        if (!option || !option.active) {
            return res.status(404).json({
                success: false,
                message: "Dropdown option not found"
            });
        }

        // Update allowed fields (key and type cannot be changed)
        if (label) option.label = label;
        if (description !== undefined) option.description = description;
        if (color) option.color = color;
        if (sortOrder !== undefined) option.sortOrder = sortOrder;
        option.updatedBy = req.user._id;

        await option.save();

        res.json({
            success: true,
            message: "Dropdown option updated successfully",
            option
        });
    } catch (error) {
        console.error("Error updating dropdown option:", error);
        res.status(500).json({
            success: false,
            message: "Failed to update dropdown option"
        });
    }
};

/**
 * DELETE /api/settings/dropdowns/:id
 * Soft delete a dropdown option
 * Access: System Admin only
 */
const deleteOption = async (req, res) => {
    try {
        const { id } = req.params;

        const option = await DropdownOption.findById(id);

        if (!option || !option.active) {
            return res.status(404).json({
                success: false,
                message: "Dropdown option not found"
            });
        }

        // Soft delete
        option.active = false;
        option.updatedBy = req.user._id;
        await option.save();

        res.json({
            success: true,
            message: "Dropdown option deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting dropdown option:", error);
        res.status(500).json({
            success: false,
            message: "Failed to delete dropdown option"
        });
    }
};

/**
 * POST /api/settings/dropdowns/:type/reorder
 * Reorder options for a dropdown type
 * Access: System Admin only
 */
const reorderOptions = async (req, res) => {
    try {
        const { type } = req.params;
        const { orderedIds } = req.body;

        if (!Array.isArray(orderedIds)) {
            return res.status(400).json({
                success: false,
                message: "orderedIds must be an array"
            });
        }

        // Update sort order for each option
        const updatePromises = orderedIds.map((id, index) =>
            DropdownOption.findByIdAndUpdate(id, {
                sortOrder: index,
                updatedBy: req.user._id
            })
        );

        await Promise.all(updatePromises);

        res.json({
            success: true,
            message: "Options reordered successfully"
        });
    } catch (error) {
        console.error("Error reordering options:", error);
        res.status(500).json({
            success: false,
            message: "Failed to reorder options"
        });
    }
};

module.exports = {
    requireSystemAdmin,
    getDropdownTypes,
    getOptions,
    createOption,
    updateOption,
    deleteOption,
    reorderOptions
};
