// // controllers/ContactCategoryController.js
// const ContactCategory = require('../models/ContactCategory');
// const Joi = require('joi');

// // Joi Validation Schemas
// const createSchema = Joi.object({
//     name: Joi.string().min(2).max(50).required(),
//     type: Joi.string().valid('internal', 'external').default('internal'),
//     description: Joi.string().allow('', null),
// });

// const updateSchema = Joi.object({
//     name: Joi.string().min(2).max(50),
//     type: Joi.string().valid('internal', 'external'),
//     active: Joi.boolean(),
//     description: Joi.string().allow('', null),
// });

// // 🔹 CREATE
// exports.createCategory = async (req, res) => {
//     try {
//         if (!req.user || !req.tenantId)
//             return res.status(400).json({ message: "Invalid request context" });

//         const { error, value } = createSchema.validate(req.body);
//         if (error) return res.status(400).json({ message: error.details[0].message });

//         if (!['admin', 'companyAdmin'].includes(req.user.role))
//             return res.status(403).json({ message: 'Access denied' });

//         const exists = await ContactCategory.findOne({
//             tenant: req.tenantId,
//             name: value.name,
//         });
//         if (exists) return res.status(400).json({ message: 'Category already exists in this company' });

//         const category = await ContactCategory.create({
//             ...value,
//             tenant: req.tenantId,
//             createdBy: req.user._id,
//         });

//         res.status(201).json({ success: true, data: { category } });
//     } catch (err) {
//         res.status(500).json({ message: 'Server error', error: err.message });
//     }
// };

// // 🔹 READ (All tenant categories)
// exports.getCategories = async (req, res) => {
//     try {
//         const filter = {
//             $or: [
//                 { isDefault: true },           // global defaults
//                 { tenant: req.tenantId },      // tenant’s own
//             ],
//             active: true,
//         };

//         const categories = await ContactCategory.find(filter)
//             .select("name type active isDefault createdAt")
//             .sort({ isDefault: -1, name: 1 }); // show defaults first

//         res.json({ success: true, count: categories.length, data: { categories } });
//     } catch (err) {
//         res.status(500).json({ message: 'Server error', error: err.message });
//     }
// };

// // 🔹 UPDATE
// exports.updateCategory = async (req, res) => {
//     try {
//         const { error, value } = updateSchema.validate(req.body);
//         if (error) return res.status(400).json({ message: error.details[0].message });

//         if (!["admin", "companyAdmin"].includes(req.user.role))
//             return res.status(403).json({ message: "Access denied" });

//         // 🔒 Prevent editing default categories
//         const target = await ContactCategory.findById(req.params.id);
//         if (!target) return res.status(404).json({ message: "Category not found" });
//         if (target.isDefault)
//             return res.status(400).json({ message: "Default categories cannot be modified" });

//         // ✅ Update allowed only on tenant’s own categories
//         const category = await ContactCategory.findOneAndUpdate(
//             { _id: req.params.id, tenant: req.tenantId },
//             { $set: value },
//             { new: true, runValidators: true }
//         );

//         res.json({ success: true, data: { category } });
//     } catch (err) {
//         res.status(500).json({ message: 'Server error', error: err.message });
//     }
// };

// // 🔹 SOFT DELETE (Deactivate)
// exports.deleteCategory = async (req, res) => {
//     try {
//         if (!["admin", "companyAdmin"].includes(req.user.role))
//             return res.status(403).json({ message: "Access denied" });

//         const target = await ContactCategory.findById(req.params.id);
//         if (!target) return res.status(404).json({ message: "Category not found" });
//         if (target.isDefault)
//             return res.status(400).json({ message: "Default categories cannot be deleted" });

//         const category = await ContactCategory.findOneAndUpdate(
//             { _id: req.params.id, tenant: req.tenantId },
//             { $set: { active: false } },
//             { new: true }
//         );

//         res.json({ success: true, message: "Category deactivated", data: { category } });
//     } catch (err) {
//         res.status(500).json({ message: 'Server error', error: err.message });
//     }
// };
// controllers/ContactCategoryController.js
const ContactCategory = require('../models/ContactCategory');
const Joi = require('joi');
const Logger = require("../utils/auditLog");

// Joi Validation Schemas
const createSchema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
    type: Joi.string().valid('internal', 'external').default('internal'),
    description: Joi.string().allow('', null),
});

const updateSchema = Joi.object({
    name: Joi.string().min(2).max(50),
    type: Joi.string().valid('internal', 'external'),
    active: Joi.boolean(),
    description: Joi.string().allow('', null),
});

// 🔹 CREATE
exports.createCategory = async (req, res) => {
    try {
        if (!req.user || !req.tenantId) {
            await Logger.warn('createCategory: Invalid request context', { userId: req.user?._id, tenantId: req.tenantId });
            return res.status(400).json({ message: "Invalid request context" });
        }

        const { error, value } = createSchema.validate(req.body);
        if (error) {
            await Logger.warn('createCategory: Validation failed', { errors: error.details, userId: req.user._id });
            return res.status(400).json({ message: error.details[0].message });
        }

        if (!['admin', 'companyAdmin'].includes(req.user.role)) {
            await Logger.warn('createCategory: Access denied', { userId: req.user._id, role: req.user.role });
            return res.status(403).json({ message: 'Access denied' });
        }

        const exists = await ContactCategory.findOne({
            tenant: req.tenantId,
            name: value.name,
        });
        if (exists) {
            await Logger.info('createCategory: Category already exists', { tenantId: req.tenantId, name: value.name });
            return res.status(400).json({ message: 'Category already exists in this company' });
        }

        const category = await ContactCategory.create({
            ...value,
            tenant: req.tenantId,
            createdBy: req.user._id,
        });

        await Logger.info('createCategory: Category created successfully', { categoryId: category._id, tenantId: req.tenantId, createdBy: req.user._id });

        res.status(201).json({ success: true, data: { category } });
    } catch (err) {
        await Logger.error('createCategory: Server error', { message: err.message, stack: err.stack, userId: req.user?._id, tenantId: req.tenantId });
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// 🔹 READ (All tenant categories)
exports.getCategories = async (req, res) => {
    try {
        const filter = {
            $or: [
                { isDefault: true },           // global defaults
                { tenant: req.tenantId },      // tenant’s own
            ],
            active: true,
        };

        const categories = await ContactCategory.find(filter)
            .select("name type active isDefault createdAt")
            .sort({ isDefault: -1, name: 1 }); // show defaults first

        await Logger.info('getCategories: Fetched categories', { tenantId: req.tenantId, count: categories.length });

        res.json({ success: true, count: categories.length, data: { categories } });
    } catch (err) {
        await Logger.error('getCategories: Server error', { message: err.message, stack: err.stack, tenantId: req.tenantId });
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// 🔹 UPDATE
exports.updateCategory = async (req, res) => {
    try {
        const { error, value } = updateSchema.validate(req.body);
        if (error) {
            await Logger.warn('updateCategory: Validation failed', { errors: error.details, tenantId: req.tenantId });
            return res.status(400).json({ message: error.details[0].message });
        }

        if (!["admin", "companyAdmin"].includes(req.user.role)) {
            await Logger.warn('updateCategory: Access denied', { userId: req.user._id, role: req.user.role });
            return res.status(403).json({ message: "Access denied" });
        }

        // 🔒 Prevent editing default categories
        const target = await ContactCategory.findById(req.params.id);
        if (!target) {
            await Logger.warn('updateCategory: Category not found', { categoryId: req.params.id });
            return res.status(404).json({ message: "Category not found" });
        }
        if (target.isDefault) {
            await Logger.info('updateCategory: Attempt to modify default category', { categoryId: req.params.id });
            return res.status(400).json({ message: "Default categories cannot be modified" });
        }

        // ✅ Update allowed only on tenant’s own categories
        const category = await ContactCategory.findOneAndUpdate(
            { _id: req.params.id, tenant: req.tenantId },
            { $set: value },
            { new: true, runValidators: true }
        );

        await Logger.info('updateCategory: Category updated successfully', { categoryId: category._id, tenantId: req.tenantId });

        res.json({ success: true, data: { category } });
    } catch (err) {
        await Logger.error('updateCategory: Server error', { message: err.message, stack: err.stack, tenantId: req.tenantId });
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};

// 🔹 SOFT DELETE (Deactivate)
exports.deleteCategory = async (req, res) => {
    try {
        if (!["admin", "companyAdmin"].includes(req.user.role)) {
            await Logger.warn('deleteCategory: Access denied', { userId: req.user._id, role: req.user.role });
            return res.status(403).json({ message: "Access denied" });
        }

        const target = await ContactCategory.findById(req.params.id);
        if (!target) {
            await Logger.warn('deleteCategory: Category not found', { categoryId: req.params.id });
            return res.status(404).json({ message: "Category not found" });
        }
        if (target.isDefault) {
            await Logger.info('deleteCategory: Attempt to delete default category', { categoryId: req.params.id });
            return res.status(400).json({ message: "Default categories cannot be deleted" });
        }

        const category = await ContactCategory.findOneAndUpdate(
            { _id: req.params.id, tenant: req.tenantId },
            { $set: { active: false } },
            { new: true }
        );

        await Logger.info('deleteCategory: Category deactivated successfully', { categoryId: category._id, tenantId: req.tenantId });

        res.json({ success: true, message: "Category deactivated", data: { category } });
    } catch (err) {
        await Logger.error('deleteCategory: Server error', { message: err.message, stack: err.stack, tenantId: req.tenantId });
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};