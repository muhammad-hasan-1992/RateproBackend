/**
 * Platform Routes
 * 
 * API endpoints for System Admin platform-level operations.
 * All routes require System Admin privileges (role === 'admin').
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { configEmailTestLimiter } = require('../middlewares/rateLimiter');
const {
    requireSystemAdmin,
    getPlatformDashboard
} = require('../controllers/platformDashboard.controller');

// All routes require authentication
router.use(protect);

// All routes require System Admin
router.use(requireSystemAdmin);

// ============================================
// PLATFORM DASHBOARD
// ============================================

/**
 * GET /api/platform/dashboard
 * Get platform-wide statistics
 * Access: System Admin only
 */
router.get('/dashboard', getPlatformDashboard);

// ============================================
// PLATFORM ESCALATION
// ============================================

const { runEscalationCheck } = require('../crons/escalation.cron');
const Logger = require('../utils/logger');

/**
 * POST /api/platform/escalation/trigger
 * Manually trigger escalation check
 * Access: System Admin only
 */
router.post('/escalation/trigger', async (req, res) => {
    try {
        const result = await runEscalationCheck();
        res.json({ success: true, ...result });
    } catch (error) {
        Logger.error("triggerEscalation", "Error triggering escalation", { error, req });
        res.status(500).json({ success: false, message: "Error triggering escalation" });
    }
});

// ============================================
// PROFILE UPDATE REVIEW (Platform Admin)
// ============================================

const {
    listPendingRequests,
    reviewRequest,
} = require('../controllers/profileUpdateController');

/**
 * GET /api/platform/profile-updates/pending
 * List all pending profile update requests
 * Access: System Admin only
 */
router.get('/profile-updates/pending', listPendingRequests);

/**
 * PATCH /api/platform/profile-updates/:id
 * Approve or reject a profile update request
 * Access: System Admin only
 */
router.patch('/profile-updates/:id', reviewRequest);

// ============================================
// PLATFORM OVERSIGHT (Read-Only Tenant Inspection)
// ============================================

const {
    getTenantOverview,
    getTenantContacts,
    getTenantSurveys,
    getTenantActions,
    getTenantUsers,
} = require('../controllers/platformOversightController');

/**
 * GET /api/platform/oversight/tenants/:tenantId
 * Tenant profile + usage summary
 */
router.get('/oversight/tenants/:tenantId', getTenantOverview);

/**
 * GET /api/platform/oversight/tenants/:tenantId/contacts
 * List tenant contacts (read-only, paginated)
 */
router.get('/oversight/tenants/:tenantId/contacts', getTenantContacts);

/**
 * GET /api/platform/oversight/tenants/:tenantId/surveys
 * List tenant surveys (read-only, paginated)
 */
router.get('/oversight/tenants/:tenantId/surveys', getTenantSurveys);

/**
 * GET /api/platform/oversight/tenants/:tenantId/actions
 * List tenant actions (read-only, paginated)
 */
router.get('/oversight/tenants/:tenantId/actions', getTenantActions);

/**
 * GET /api/platform/oversight/tenants/:tenantId/users
 * List tenant users (read-only, paginated)
 */
router.get('/oversight/tenants/:tenantId/users', getTenantUsers);

// ============================================
// SYSTEM CONFIGURATION (Platform-Level Config CRUD)
// ============================================

const {
    listAllConfigs,
    listConfigsByCategory,
    upsertConfig,
    resetConfig,
    testEmailConfig,
} = require('../controllers/systemConfigController');

/**
 * GET /api/platform/config
 * List all system configs (values masked for sensitive keys)
 */
router.get('/config', listAllConfigs);

/**
 * GET /api/platform/config/:category
 * List configs by category
 */
router.get('/config/:category', listConfigsByCategory);

/**
 * PUT /api/platform/config/:key
 * Create or update a system config
 */
router.put('/config/:key', upsertConfig);

/**
 * DELETE /api/platform/config/:key
 * Reset a config to ENV fallback
 */
router.delete('/config/:key', resetConfig);

/**
 * POST /api/platform/config/test-email
 * Test email delivery with current config
 * Rate limited: 3 requests per 5 minutes per admin
 */
router.post('/config/test-email', configEmailTestLimiter, testEmailConfig);

module.exports = router;
