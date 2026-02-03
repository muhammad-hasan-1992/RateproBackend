// routes/adminSubscriptionRoutes.js
// ============================================================================
// Admin Subscription Routes - PLATFORM LAYER (System Admin Only)
// 
// These routes are EXCLUSIVE to system admins (role: 'admin').
// Company Admins and Members MUST NOT access these routes.
// ============================================================================

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { enforcePlatformScope } = require('../middlewares/scopeMiddleware');

// Controllers
const {
    createFeatureDefinition,
    getAllFeatureDefinitions,
    updateFeatureDefinition,
    deleteFeatureDefinition,
    createPlanTemplate,
    getAllPlanTemplates,
    getPlanTemplate,
    updatePlanTemplate,
    deletePlanTemplate,
    getAllTenantSubscriptions,
    setTenantCustomFeature,
    applyPlanToTenant
} = require('../controllers/subscription/adminController');

// ============ PLATFORM ADMIN ONLY ROUTES ============
// Middleware chain: protect → enforcePlatformScope → allowRoles('admin')
router.use(protect);
router.use(enforcePlatformScope);  // Blocks non-admin users
router.use(allowRoles('admin'));   // Defense in depth

// Feature Definitions
router.route('/features')
    .get(getAllFeatureDefinitions)
    .post(createFeatureDefinition);

router.route('/features/:id')
    .put(updateFeatureDefinition)
    .delete(deleteFeatureDefinition);

// Plan Templates
router.route('/plans')
    .get(getAllPlanTemplates)
    .post(createPlanTemplate);

router.route('/plans/:id')
    .get(getPlanTemplate)
    .put(updatePlanTemplate)
    .delete(deletePlanTemplate);

// Tenant Subscription Management
router.get('/subscriptions', getAllTenantSubscriptions);
router.post('/subscriptions/:tenantId/features', setTenantCustomFeature);
router.post('/subscriptions/:tenantId/apply-plan', applyPlanToTenant);

module.exports = router;
