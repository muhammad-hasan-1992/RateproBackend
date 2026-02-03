// /Routes/userRoutes.js
// ============================================================================
// User Routes - TENANT LAYER (Company Admin + Member)
// 
// These routes are for tenant-scoped user management.
// System Admin (role: 'admin') MUST NOT access these routes.
// ============================================================================

const express = require('express');
const router = express.Router();
// const upload = require('../middlewares/multer');
const { upload, excelUpload } = require('../middlewares/multer');
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { allowPermission } = require('../middlewares/permissionMiddleware');
// Note: enforceTenantScope removed - Admin users need access to all users
const {
  createUser,
  updateUser,
  deleteUser,
  toggleActive,
  getAllUsers,
  getUserById,
  exportUserDataPDF,
  sendNotification,
  updateMe,
  bulkCreateUsers,
  getTenantUsersForPicker,
} = require('../controllers/userController');

// Middleware to set tenantId for company-specific routes
// Admin users bypass tenant check (Platform Admin has access to all tenants)
const setTenantId = (req, res, next) => {
  // Skip tenant check for Admin (Platform/System Admin)
  if (req.user.role === "admin") {
    req.tenantId = null; // No tenant restriction for admin
    return next();
  }

  if (!req.user.tenant) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: No tenant associated with this user',
      code: 'NO_TENANT_CONTEXT'
    });
  }

  req.tenantId = req.user.tenant._id ? req.user.tenant._id.toString() : req.user.tenant.toString();
  next();
};

// Public/Authenticated route for user self-update
router.put('/me', protect, upload.single('avatar'), updateMe);

// Protected routes - Apply tenant context
// Note: enforceTenantScope removed to allow Admin access to all users
router.use(protect, setTenantId);

// User picker for assignment dropdowns (all authenticated users can access)
router.get('/picker', getTenantUsersForPicker);

// Routes for admin and companyAdmin (no permission check)
router.post('/', allowRoles('admin', 'companyAdmin'), createUser);
router.get('/', allowRoles('admin', 'companyAdmin'), getAllUsers);
router.get('/:id', allowRoles('admin', 'companyAdmin'), getUserById);
router.put('/:id', allowRoles('admin', 'companyAdmin'), upload.single('avatar'), updateUser);
router.delete('/:id', allowRoles('admin', 'companyAdmin'), deleteUser);
router.put('/toggle/:id', allowRoles('admin', 'companyAdmin'), toggleActive);
router.get('/export/:id', allowRoles('admin', 'companyAdmin'), exportUserDataPDF);
router.post('/notify/:id', allowRoles('admin', 'companyAdmin'), sendNotification);
router.post('/bulk-upload', protect, setTenantId, allowRoles('companyAdmin'), excelUpload.single('excel'), bulkCreateUsers);

// Routes for member with permission check
router.post('/', allowRoles('member'), allowPermission('user:create'), createUser);
router.get('/', allowRoles('member'), allowPermission('user:read'), getAllUsers);
router.get('/:id', allowRoles('member'), allowPermission('user:read'), getUserById);
router.put('/:id', allowRoles('member'), allowPermission('user:update'), upload.single('avatar'), updateUser);
router.delete('/:id', allowRoles('member'), allowPermission('user:delete'), deleteUser);
router.get('/export/:id', allowRoles('member'), allowPermission('user:export'), exportUserDataPDF);
router.post('/notify/:id', allowRoles('member'), allowPermission('user:notify'), sendNotification);

module.exports = router;
