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
const { setTenantId } = require('../middlewares/tenantMiddleware');
// Note: enforceTenantScope removed - Admin users need access to all users (Shared route)
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

// Tenant context via canonical tenantMiddleware.setTenantId
// Admin users bypass tenant check (req.tenantId = null for admin)

// Public/Authenticated route for user self-update
router.put('/me', protect, upload.single('avatar'), updateMe);

// Protected routes - Apply tenant context
// Note: enforceTenantScope removed to allow Admin access to all users
router.use(protect, setTenantId);

// User picker for assignment dropdowns (all authenticated users can access)
router.get('/picker', getTenantUsersForPicker);

// ─── Static/specific routes FIRST (before /:id) ───

// Bulk upload (companyAdmin only)
router.post('/bulk-upload', protect, setTenantId, allowRoles('companyAdmin'), excelUpload.single('excel'), bulkCreateUsers);

// Routes with sub-paths (must precede /:id to avoid param capture)
router.put('/toggle/:id', allowRoles('admin', 'companyAdmin'), toggleActive);
router.get('/export/:id', allowRoles('admin', 'companyAdmin'), exportUserDataPDF);
router.post('/notify/:id', allowRoles('admin', 'companyAdmin'), sendNotification);

// ─── Generic CRUD routes for admin and companyAdmin ───
router.post('/', allowRoles('admin', 'companyAdmin'), createUser);
router.get('/', allowRoles('admin', 'companyAdmin'), getAllUsers);
router.get('/:id', allowRoles('admin', 'companyAdmin'), getUserById);
router.put('/:id', allowRoles('admin', 'companyAdmin'), upload.single('avatar'), updateUser);
router.delete('/:id', allowRoles('admin', 'companyAdmin'), deleteUser);

// ─── Member routes with permission checks ───
router.get('/export/:id', allowRoles('member'), allowPermission('user:export'), exportUserDataPDF);
router.post('/notify/:id', allowRoles('member'), allowPermission('user:notify'), sendNotification);
router.post('/', allowRoles('member'), allowPermission('user:create'), createUser);
router.get('/', allowRoles('member'), allowPermission('user:read'), getAllUsers);
router.get('/:id', allowRoles('member'), allowPermission('user:read'), getUserById);
router.put('/:id', allowRoles('member'), allowPermission('user:update'), upload.single('avatar'), updateUser);
router.delete('/:id', allowRoles('member'), allowPermission('user:delete'), deleteUser);

module.exports = router;
