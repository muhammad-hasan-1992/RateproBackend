/**
 * Dropdown Settings Routes
 * 
 * API endpoints for managing configurable dropdown options.
 * 
 * Access Control:
 * - Read operations (GET): All authenticated users
 * - CRUD operations (POST/PUT/DELETE): System Admin only
 */

const express = require('express');
const router = express.Router();
const {
    requireSystemAdmin,
    getDropdownTypes,
    getOptions,
    createOption,
    updateOption,
    deleteOption,
    reorderOptions
} = require('../controllers/dropdownSettingsController');
const { protect } = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(protect);

// ============================================
// READ OPERATIONS - All authenticated users
// ============================================

// Get all dropdown types with counts
router.get('/types', getDropdownTypes);

// Get options by type
router.get('/:type', getOptions);

// ============================================
// CRUD OPERATIONS - System Admin only
// ============================================

// Create a new option
router.post('/', requireSystemAdmin, createOption);

// Update an option
router.put('/:id', requireSystemAdmin, updateOption);

// Delete an option (soft delete)
router.delete('/:id', requireSystemAdmin, deleteOption);

// Reorder options within a type
router.post('/:type/reorder', requireSystemAdmin, reorderOptions);

module.exports = router;
