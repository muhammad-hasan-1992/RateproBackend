// routes/permissionAssignmentRoutes.js
// ============================================================================
// Permission Assignment Routes - TENANT LAYER (Company Admin + Member)
// 
// These routes are for tenant-scoped permission assignment.
// System Admin (role: 'admin') MUST NOT access these routes.
// ============================================================================

const express = require('express');
const router = express.Router();
const {
  assignPermission,
  removePermission,
  getAssignments,
  getTenantUsers,
  getUserPermissions,
} = require('../controllers/permissionAssignmentController');
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { allowPermission } = require('../middlewares/permissionMiddleware');
const { setTenantId } = require('../middlewares/tenantMiddleware');
const { enforceTenantScope } = require('../middlewares/scopeMiddleware');

// Custom middleware to skip permission check for companyAdmin
const checkPermissionForMember = (permission) => (req, res, next) => {
  if (req.user.role === 'companyAdmin') {
    return next(); // Skip permission check for companyAdmin
  }
  // Apply allowPermission for member
  return allowPermission(permission)(req, res, next);
};

// ============================================================================
// 🔒 Protect all routes and apply tenant scoping - TENANT LAYER
// ============================================================================
// Middleware chain: protect → setTenantId → enforceTenantScope
router.use(protect);
router.use(setTenantId);
router.use(enforceTenantScope);  // Blocks System Admin from tenant resources

// Routes for companyAdmin (no permission check) and member (with permission check)
router.post(
  '/task-assignments',
  allowRoles('companyAdmin', 'member'),
  checkPermissionForMember('permission:assign'),
  assignPermission
);

router.delete(
  '/task-assignments/:id',
  allowRoles('companyAdmin', 'member'),
  checkPermissionForMember('permission:assign'),
  removePermission
);

router.get(
  '/task-assignments',
  allowRoles('companyAdmin', 'member'),
  checkPermissionForMember('permission:read'),
  getAssignments
);

router.get(
  '/users',
  allowRoles('companyAdmin', 'member'),
  checkPermissionForMember('user:read'),
  getTenantUsers
);

router.get('/permissions/me', allowRoles('companyAdmin', 'member'), getUserPermissions);

module.exports = router;