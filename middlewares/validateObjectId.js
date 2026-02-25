// middlewares/validateObjectId.js
// ============================================================================
// Standalone ObjectId Validation Middleware
// 
// Single responsibility: validates that a route parameter is a valid
// MongoDB ObjectId. Chain with other middleware for full authorization.
// ============================================================================

const mongoose = require('mongoose');

/**
 * Validates that a route parameter is a valid MongoDB ObjectId.
 * Returns 400 if invalid. Use before any middleware that reads req.params[paramName].
 * 
 * @param {string} paramName - req.params key to validate (e.g. 'id', 'tenantId')
 * @returns {Function} Express middleware
 * 
 * @example
 * router.get('/:id', validateObjectId('id'), enforceTenantOwnership(), getTenant);
 */
exports.validateObjectId = (paramName = 'id') => (req, res, next) => {
    const value = req.params[paramName];
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        return res.status(400).json({
            success: false,
            message: `Invalid ${paramName}: must be a valid ObjectId`,
            code: 'INVALID_OBJECT_ID'
        });
    }
    next();
};
