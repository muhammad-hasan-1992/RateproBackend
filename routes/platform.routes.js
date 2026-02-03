/**
 * Platform Routes
 * 
 * API endpoints for System Admin platform-level operations.
 * All routes require System Admin privileges (role === 'admin').
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
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

module.exports = router;
