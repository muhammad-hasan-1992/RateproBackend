// routes/subscriptionRoutes.js
// Subscription management routes

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');
const { setTenantId } = require('../middlewares/tenantMiddleware');

// Controllers
const {
    getSubscriptionStatus,
    getPublicPlans,
    getCurrentSubscription,
    getMyPlan,
    subscribeToPlan,
    createCheckoutSession,
    upgradePlan,
    previewUpgrade,
    downgradePlan,
    cancelSubscription,
    getBillingPortal,
    getUsageReport,
    comparePlans,
    verifyCheckoutSession
} = require('../controllers/subscription/subscriptionController');

const {
    handleStripeWebhook,
    handleTapWebhook
} = require('../controllers/subscription/webhookController');

const {
    onboardAndCheckout
} = require('../controllers/subscription/onboardingController');

// ============ PUBLIC ROUTES ============

// Get all public plans for pricing page
router.get('/plans', getPublicPlans);

// Compare two plans
router.get('/compare', comparePlans);

// Check provisioning status via session_id (for public checkout-success page)
router.get('/status', getSubscriptionStatus);

// ============ WEBHOOK ROUTES (Raw body needed for signature verification) ============
// Note: These endpoints need raw body, configure in server.js

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
router.post('/webhooks/tap', express.raw({ type: 'application/json' }), handleTapWebhook);

// ============ PRE-TENANT ROUTES (before setTenantId — user may not have tenant yet) ============
router.post('/onboard', protect, onboardAndCheckout);
router.get('/current', protect, getCurrentSubscription);
router.post('/verify-session', protect, verifyCheckoutSession);

// ============ PROTECTED ROUTES ============

router.use(protect, setTenantId);

// (moved above setTenantId barrier)

// Get usage report
router.get('/usage', getUsageReport);

// Subscribe to a plan (manual/free)
router.post('/subscribe', allowRoles('companyAdmin', 'admin'), subscribeToPlan);

// Create checkout session for paid subscription
router.post('/checkout', allowRoles('companyAdmin', 'admin'), createCheckoutSession);

// Get My Plan (complete plan data in one call)
router.get('/my-plan', allowRoles('companyAdmin'), getMyPlan);

// Upgrade plan
router.post('/upgrade', allowRoles('companyAdmin', 'admin'), upgradePlan);

// Preview upgrade proration
router.post('/upgrade-preview', allowRoles('companyAdmin', 'admin'), previewUpgrade);

// Downgrade plan
router.post('/downgrade', allowRoles('companyAdmin', 'admin'), downgradePlan);

// Cancel subscription
router.post('/cancel', allowRoles('companyAdmin', 'admin'), cancelSubscription);

// Get billing portal URL
router.get('/billing-portal', allowRoles('companyAdmin', 'admin'), getBillingPortal);

module.exports = router;
