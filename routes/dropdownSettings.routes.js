/**
 * Dropdown Settings Routes
 * 
 * API endpoints for managing configurable dropdown options.
 * 
 * Access Control:
 * - Read operations (GET): All authenticated users
 * - CRUD operations (POST/PUT/DELETE): System Admin only (via shared allowRoles middleware)
 */

const express = require('express');
const router = express.Router();
const {
    getDropdownTypes,
    getOptions,
    createOption,
    updateOption,
    deleteOption,
    reorderOptions
} = require('../controllers/dropdownSettingsController');
const { protect } = require('../middlewares/authMiddleware');
const { allowRoles } = require('../middlewares/roleMiddleware');

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
// CRUD OPERATIONS - System Admin only (shared middleware)
// ============================================

// Create a new option
router.post('/', allowRoles('admin'), createOption);

// Update an option
router.put('/:id', allowRoles('admin'), updateOption);

// Delete an option (soft delete)
router.delete('/:id', allowRoles('admin'), deleteOption);

// Reorder options within a type
router.post('/:type/reorder', allowRoles('admin'), reorderOptions);

module.exports = router;
