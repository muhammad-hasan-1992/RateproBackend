// controllers/contactCategoryController.js
const mongoose = require("mongoose");
const ContactCategory = require("../models/ContactCategory");
const Contact = require("../models/ContactManagement");
const Joi = require("joi");
const Logger = require("../utils/logger");

// ─────────────────────────────────────────────────────────────
// Joi Validation Schemas
// ─────────────────────────────────────────────────────────────
const createSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  type: Joi.string().valid("internal", "external").default("external"),
  description: Joi.string().max(255).allow("", null),
});

const updateSchema = Joi.object({
  name: Joi.string().min(2).max(50),
  type: Joi.string().valid("internal", "external"),
  description: Joi.string().max(255).allow("", null),
  active: Joi.boolean(),
});

// ─────────────────────────────────────────────────────────────
// 🔹 CREATE CATEGORY
// POST /api/contact-categories
// ─────────────────────────────────────────────────────────────
exports.createCategory = async (req, res) => {
  try {
    if (!req.user || !req.tenantId) {
      Logger.warn("createCategory", "Invalid request context", {
        context: { userId: req.user?._id, tenantId: req.tenantId },
        req,
      });
      return res.status(400).json({ message: "Invalid request context" });
    }

    const { error, value } = createSchema.validate(req.body);
    if (error) {
      Logger.warn("createCategory", "Validation failed", {
        context: { errors: error.details, userId: req.user._id },
        req,
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    if (!["admin", "companyAdmin"].includes(req.user.role)) {
      Logger.warn("createCategory", "Access denied", {
        context: { userId: req.user._id, role: req.user.role },
        req,
      });
      return res.status(403).json({ message: "Access denied" });
    }

    // Check for duplicate name within tenant
    const exists = await ContactCategory.findOne({
      tenant: req.tenantId,
      name: { $regex: new RegExp(`^${value.name}$`, "i") }, // case-insensitive
      active: true,
    });

    if (exists) {
      Logger.info("createCategory", "Category already exists", {
        context: { tenantId: req.tenantId, name: value.name },
        req,
      });
      return res.status(400).json({ message: "Category already exists" });
    }

    const category = await ContactCategory.create({
      ...value,
      tenant: req.tenantId,
      createdBy: req.user._id,
    });

    Logger.info("createCategory", "Category created successfully", {
      context: {
        categoryId: category._id,
        tenantId: req.tenantId,
        createdBy: req.user._id,
      },
      req,
    });

    res.status(201).json({
      success: true,
      data: { category },
    });
  } catch (err) {
    Logger.error("createCategory", "Server error", {
      error: err,
      context: { userId: req.user?._id, tenantId: req.tenantId },
      req,
    });
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// 🔹 GET ALL CATEGORIES (with contact count)
// GET /api/contact-categories
// ─────────────────────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);

    const categories = await ContactCategory.aggregate([
      {
        $match: {
          active: true,
          $or: [
            { isDefault: true },
            { tenant: tenantObjectId },
          ],
        },
      },

      // Lookup contact count for each category
      {
        $lookup: {
          from: "contacts",
          let: { categoryId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$tenantId", tenantObjectId] },
                    {
                      $in: [
                        "$$categoryId",
                        { $ifNull: ["$contactCategories", []] },
                      ],
                    },
                  ],
                },
              },
            },
            { $count: "total" },
          ],
          as: "contactsMeta",
        },
      },

      // Add computed size field
      {
        $addFields: {
          contactCount: {
            $ifNull: [{ $arrayElemAt: ["$contactsMeta.total", 0] }, 0],
          },
        },
      },

      // Clean up
      { $project: { contactsMeta: 0 } },

      // Sort: defaults first, then alphabetically
      { $sort: { isDefault: -1, name: 1 } },
    ]);

    Logger.info("getCategories", "Categories fetched", {
      context: { tenantId: req.tenantId, count: categories.length },
      req,
    });

    res.json({
      success: true,
      count: categories.length,
      data: { categories },
    });
  } catch (err) {
    Logger.error("getCategories", "Server error", {
      error: err,
      context: { tenantId: req.tenantId },
      req,
    });
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// 🔹 GET SINGLE CATEGORY BY ID
// GET /api/contact-categories/:id
// ─────────────────────────────────────────────────────────────
exports.getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const category = await ContactCategory.findOne({
      _id: id,
      active: true,
      $or: [
        { tenant: req.tenantId },
        { isDefault: true },
      ],
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Get contact count for this category
    const contactCount = await Contact.countDocuments({
      tenantId: req.tenantId,
      contactCategories: id,
    });

    res.json({
      success: true,
      data: {
        category: {
          ...category.toObject(),
          contactCount,
        },
      },
    });
  } catch (err) {
    Logger.error("getCategoryById", "Server error", {
      error: err,
      context: { tenantId: req.tenantId, categoryId: req.params.id },
      req,
    });
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// 🔹 UPDATE CATEGORY
// PATCH /api/contact-categories/:id
// ─────────────────────────────────────────────────────────────
exports.updateCategory = async (req, res) => {
  try {
    const { error, value } = updateSchema.validate(req.body);
    if (error) {
      Logger.warn("updateCategory", "Validation failed", {
        context: { errors: error.details, tenantId: req.tenantId },
        req,
      });
      return res.status(400).json({ message: error.details[0].message });
    }

    if (!["admin", "companyAdmin"].includes(req.user.role)) {
      Logger.warn("updateCategory", "Access denied", {
        context: { userId: req.user._id, role: req.user.role },
        req,
      });
      return res.status(403).json({ message: "Access denied" });
    }

    // Find the target category
    const target = await ContactCategory.findById(req.params.id);
    if (!target) {
      Logger.warn("updateCategory", "Category not found", {
        context: { categoryId: req.params.id },
        req,
      });
      return res.status(404).json({ message: "Category not found" });
    }

    // 🔒 Prevent editing default/system categories
    if (target.isDefault) {
      Logger.info("updateCategory", "Attempt to modify default category", {
        context: { categoryId: req.params.id },
        req,
      });
      return res.status(400).json({ message: "Default categories cannot be modified" });
    }

    // 🔒 Ensure category belongs to tenant
    if (target.tenant?.toString() !== req.tenantId.toString()) {
      return res.status(403).json({ message: "Access denied to this category" });
    }

    // Check for name conflict if name is being changed
    if (value.name && value.name !== target.name) {
      const nameConflict = await ContactCategory.findOne({
        tenant: req.tenantId,
        name: { $regex: new RegExp(`^${value.name}$`, "i") },
        active: true,
        _id: { $ne: req.params.id },
      });

      if (nameConflict) {
        return res.status(400).json({ message: "A category with this name already exists" });
      }
    }

    // ✅ Perform update
    const category = await ContactCategory.findOneAndUpdate(
      { _id: req.params.id, tenant: req.tenantId },
      { $set: value },
      { new: true, runValidators: true }
    );

    Logger.info("updateCategory", "Category updated successfully", {
      context: { categoryId: category._id, tenantId: req.tenantId },
      req,
    });

    res.json({
      success: true,
      data: { category },
    });
  } catch (err) {
    Logger.error("updateCategory", "Server error", {
      error: err,
      context: { tenantId: req.tenantId },
      req,
    });
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// 🔹 DELETE CATEGORY (Soft delete)
// DELETE /api/contact-categories/:id
// ─────────────────────────────────────────────────────────────
exports.deleteCategory = async (req, res) => {
  try {
    if (!["admin", "companyAdmin"].includes(req.user.role)) {
      Logger.warn("deleteCategory", "Access denied", {
        context: { userId: req.user._id, role: req.user.role },
        req,
      });
      return res.status(403).json({ message: "Access denied" });
    }

    const target = await ContactCategory.findById(req.params.id);
    if (!target) {
      Logger.warn("deleteCategory", "Category not found", {
        context: { categoryId: req.params.id },
        req,
      });
      return res.status(404).json({ message: "Category not found" });
    }

    // 🔒 Prevent deleting default categories
    if (target.isDefault) {
      Logger.info("deleteCategory", "Attempt to delete default category", {
        context: { categoryId: req.params.id },
        req,
      });
      return res.status(400).json({ message: "Default categories cannot be deleted" });
    }

    // 🔒 Ensure category belongs to tenant
    if (target.tenant?.toString() !== req.tenantId.toString()) {
      return res.status(403).json({ message: "Access denied to this category" });
    }

    // 🔒 Check if category is in use
    const contactsUsingCategory = await Contact.countDocuments({
      tenantId: req.tenantId,
      contactCategories: req.params.id,
    });

    if (contactsUsingCategory > 0) {
      return res.status(400).json({
        message: `Cannot delete category: ${contactsUsingCategory} contact(s) are using it. Reassign contacts first.`,
        contactCount: contactsUsingCategory,
      });
    }

    // ✅ Soft delete (deactivate)
    const category = await ContactCategory.findOneAndUpdate(
      { _id: req.params.id, tenant: req.tenantId },
      { $set: { active: false } },
      { new: true }
    );

    Logger.info("deleteCategory", "Category deactivated successfully", {
      context: { categoryId: category._id, tenantId: req.tenantId },
      req,
    });

    res.json({
      success: true,
      message: "Category deactivated",
      data: { category },
    });
  } catch (err) {
    Logger.error("deleteCategory", "Server error", {
      error: err,
      context: { tenantId: req.tenantId },
      req,
    });
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// 🔹 GET CONTACTS BY CATEGORY
// GET /api/contact-categories/:id/contacts
// ─────────────────────────────────────────────────────────────
exports.getContactsByCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, search = "" } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    // Verify category exists and is accessible
    const category = await ContactCategory.findOne({
      _id: id,
      active: true,
      $or: [
        { tenant: req.tenantId },
        { isDefault: true },
      ],
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Build filter
    const filter = {
      tenantId: req.tenantId,
      contactCategories: id,
    };

    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { name: regex },
        { email: regex },
        { company: regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select("name email phone company status tags createdAt"),
      Contact.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        category: {
          _id: category._id,
          name: category.name,
        },
        contacts,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    Logger.error("getContactsByCategory", "Server error", {
      error: err,
      context: { tenantId: req.tenantId, categoryId: req.params.id },
      req,
    });
    res.status(500).json({ message: "Server error", error: err.message });
  }
};