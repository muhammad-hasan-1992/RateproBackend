// routes/tenantRoutes.js
// ============================================================================
// Tenant Routes - MIXED LAYER
// 
// /me routes: TENANT LAYER - Company Admin viewing their own tenant
// /:id routes: PLATFORM LAYER - Admin managing tenants
// ============================================================================

const express = require('express');
const router = express.Router();
const { getTenant, updateTenant, getMyTenant, updateMyPlan } = require('../controllers/tenantController');
const { protect } = require('../middlewares/authMiddleware');
const { setTenantId } = require('../middlewares/tenantMiddleware');
const { enforceTenantScope, enforcePlatformScope } = require('../middlewares/scopeMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');

// ============================================================================
// 🔵 TENANT LAYER ROUTES (Company Admin viewing their own tenant)
// ============================================================================
// GET /me - Company admin views their own tenant
router.get('/me', protect, setTenantId, enforceTenantScope, allowRoles('companyAdmin'), getMyTenant);

// PUT /me - Company admin updates their own tenant (if implemented)
// router.put('/me', protect, setTenantId, enforceTenantScope, allowRoles('companyAdmin'), updateMyTenant);

// ============================================================================
// 🔴 PLATFORM LAYER ROUTES (Admin managing all tenants)
// ============================================================================
// These routes are for platform admin to manage tenants
router.get('/:id', protect, enforcePlatformScope, allowRoles('admin'), getTenant);
router.put('/:tenantId', protect, enforcePlatformScope, allowRoles('admin'), updateTenant);

module.exports = router;