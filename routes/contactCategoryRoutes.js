// routes/userCategory.js
const express = require('express');
const router = express.Router();

const {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
} = require('../controllers/contactCategoryController');

const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { allowPermission } = require('../middlewares/permissionMiddleware');
const { setTenantId } = require('../middlewares/tenantMiddleware');

// 🔹 Base: all routes protected + tenant context applied
router.use(protect, setTenantId);

/**
 * @route   POST /api/user-categories
 * @desc    Create a new user category
 * @access  CompanyAdmin | Admin
 */
router.post(
  '/',
  allowRoles('admin', 'companyAdmin'),
  allowPermission('category:create'),
  createCategory
);

/**
 * @route   GET /api/user-categories
 * @desc    Get all categories for the tenant
 * @access  CompanyAdmin | Member | Admin
 */
router.get(
  '/',
  allowRoles('admin', 'companyAdmin', 'member'),
  allowPermission('category:read'),
  getCategories
);

/**
 * @route   PATCH /api/user-categories/:id
 * @desc    Update a category
 * @access  CompanyAdmin | Admin
 */
router.patch(
  '/:id',
  allowRoles('admin', 'companyAdmin'),
  allowPermission('category:update'),
  updateCategory
);

/**
 * @route   DELETE /api/user-categories/:id
 * @desc    Soft delete (deactivate) a category
 * @access  CompanyAdmin | Admin
 */
router.delete(
  '/:id',
  allowRoles('admin', 'companyAdmin'),
  allowPermission('category:delete'),
  deleteCategory
);

module.exports = router;