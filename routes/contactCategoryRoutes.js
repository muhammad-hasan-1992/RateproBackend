// routes/contactCategoryRoutes.js
const express = require("express");
const router = express.Router();

const {
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  getContactsByCategory,
} = require("../controllers/contactCategoryController");

const { protect } = require("../middlewares/authMiddleware");
const { allowRoles } = require("../middlewares/roleMiddleware");
const { allowPermission } = require("../middlewares/permissionMiddleware");
const { setTenantId } = require("../middlewares/tenantMiddleware");

// 🔹 Base: all routes protected + tenant context applied
router.use(protect, setTenantId);

/**
 * @route   POST /api/contact-categories
 * @desc    Create a new contact category
 * @access  CompanyAdmin | Admin
 */
router.post(
  "/",
  allowRoles("admin", "companyAdmin"),
  allowPermission("category:create"),
  createCategory
);

/**
 * @route   GET /api/contact-categories
 * @desc    Get all categories for the tenant (with contact counts)
 * @access  CompanyAdmin | Member | Admin
 */
router.get(
  "/",
  allowRoles("admin", "companyAdmin", "member"),
  allowPermission("category:read"),
  getCategories
);

/**
 * @route   GET /api/contact-categories/:id
 * @desc    Get a single category by ID
 * @access  CompanyAdmin | Member | Admin
 */
router.get(
  "/:id",
  allowRoles("admin", "companyAdmin", "member"),
  allowPermission("category:read"),
  getCategoryById
);

/**
 * @route   GET /api/contact-categories/:id/contacts
 * @desc    Get all contacts belonging to a category
 * @access  CompanyAdmin | Admin
 */
router.get(
  "/:id/contacts",
  allowRoles("admin", "companyAdmin"),
  allowPermission("category:read"),
  getContactsByCategory
);

/**
 * @route   PATCH /api/contact-categories/:id
 * @desc    Update a category
 * @access  CompanyAdmin | Admin
 */
router.patch(
  "/:id",
  allowRoles("admin", "companyAdmin"),
  allowPermission("category:update"),
  updateCategory
);

/**
 * @route   DELETE /api/contact-categories/:id
 * @desc    Soft delete (deactivate) a category
 * @access  CompanyAdmin | Admin
 */
router.delete(
  "/:id",
  allowRoles("admin", "companyAdmin"),
  allowPermission("category:delete"),
  deleteCategory
);

module.exports = router;