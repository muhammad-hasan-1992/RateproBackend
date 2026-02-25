// routes/tenantRoutes.js
// ============================================================================
// Tenant Routes - DUAL-SCOPE (Platform + Tenant)
// 
// /me routes: TENANT LAYER - Company Admin/Member viewing their own tenant
// /:id routes: SHARED - Admin (any tenant) OR CompanyAdmin/Member (own tenant)
// ============================================================================

const express = require('express');
const router = express.Router();
const { getTenant, updateTenant, getMyTenant, updateMyPlan } = require('../controllers/tenantController');
const { protect } = require('../middlewares/authMiddleware');
const { setTenantId } = require('../middlewares/tenantMiddleware');
const { enforceTenantScope } = require('../middlewares/scopeMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { validateObjectId } = require('../middlewares/validateObjectId');
const { enforceTenantOwnership } = require('../middlewares/dualScopeMiddleware');

// ============================================================================
// 🔵 TENANT LAYER ROUTES (Company Admin/Member viewing their own tenant)
// ============================================================================
// GET /me - Company admin/member views their own tenant
router.get('/me', protect, setTenantId, enforceTenantScope, allowRoles('companyAdmin', 'member'), getMyTenant);

// ============================================================================
// 🟡 DUAL-SCOPE ROUTES (Admin → any, CompanyAdmin/Member → own)
// ============================================================================
// GET /:id - Read tenant (admin: any, companyAdmin/member: own only)
router.get('/:id', protect, validateObjectId('id'), enforceTenantOwnership(), getTenant);

// PUT /:tenantId - Update tenant (admin: any, companyAdmin: own only)
router.put('/:tenantId', protect, validateObjectId('tenantId'),
    allowRoles('admin', 'companyAdmin'),
    enforceTenantOwnership({ tenantParam: 'tenantId', allowedRoles: ['companyAdmin'] }),
    updateTenant
);

module.exports = router;