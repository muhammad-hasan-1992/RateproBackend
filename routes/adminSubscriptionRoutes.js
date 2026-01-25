// routes/adminSubscriptionRoutes.js
// Admin routes for managing subscription system

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');

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

// ============ ADMIN ONLY ROUTES ============

router.use(protect);
router.use(allowRoles('admin'));

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
