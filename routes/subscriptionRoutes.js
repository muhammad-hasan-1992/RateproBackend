// routes/subscriptionRoutes.js
// Subscription management routes

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { setTenantId } = require('../middlewares/tenantMiddleware');

// Controllers
const {
    getPublicPlans,
    getCurrentSubscription,
    subscribeToPlan,
    createCheckoutSession,
    upgradePlan,
    downgradePlan,
    cancelSubscription,
    getBillingPortal,
    getUsageReport,
    comparePlans
} = require('../controllers/subscription/subscriptionController');

const {
    handleStripeWebhook,
    handleTapWebhook
} = require('../controllers/subscription/webhookController');

// ============ PUBLIC ROUTES ============

// Get all public plans for pricing page
router.get('/plans', getPublicPlans);

// Compare two plans
router.get('/compare', comparePlans);

// ============ WEBHOOK ROUTES (Raw body needed for signature verification) ============
// Note: These endpoints need raw body, configure in server.js

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
router.post('/webhooks/tap', express.raw({ type: 'application/json' }), handleTapWebhook);

// ============ PROTECTED ROUTES ============

router.use(protect, setTenantId);

// Get current subscription
router.get('/current', getCurrentSubscription);

// Get usage report
router.get('/usage', getUsageReport);

// Subscribe to a plan (manual/free)
router.post('/subscribe', allowRoles('companyAdmin', 'admin'), subscribeToPlan);

// Create checkout session for paid subscription
router.post('/checkout', allowRoles('companyAdmin', 'admin'), createCheckoutSession);

// Upgrade plan
router.post('/upgrade', allowRoles('companyAdmin', 'admin'), upgradePlan);

// Downgrade plan
router.post('/downgrade', allowRoles('companyAdmin', 'admin'), downgradePlan);

// Cancel subscription
router.post('/cancel', allowRoles('companyAdmin', 'admin'), cancelSubscription);

// Get billing portal URL
router.get('/billing-portal', allowRoles('companyAdmin', 'admin'), getBillingPortal);

module.exports = router;
