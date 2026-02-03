// middlewares/roleMiddleware.js
// ============================================================================
// Role-Based Access Control Middleware
// 
// This middleware checks if the user's role is in the allowed roles list.
// For permission-based access within a role, use permissionMiddleware.js
// 
// Usage: router.get('/route', allowRoles('admin', 'companyAdmin'), controller)
// ============================================================================

/**
 * Allow specific roles to access the route
 * @param {...string} roles - Roles allowed to access (e.g., 'admin', 'companyAdmin', 'member')
 */
exports.allowRoles = (...roles) => (req, res, next) => {
  // Ensure user is authenticated
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  // Check if user's role is in allowed roles
  if (!roles.includes(req.user.role)) {
    console.warn(`[SECURITY] Role access denied: User ${req.user._id} with role '${req.user.role}' attempted to access route requiring roles: [${roles.join(', ')}]`);
    return res.status(403).json({
      success: false,
      message: 'Access denied: Role not authorized',
      code: 'ROLE_NOT_AUTHORIZED'
    });
  }

  next();
};

/**
 * Deny specific roles from accessing the route
 * @param {...string} roles - Roles to explicitly deny
 */
exports.denyRoles = (...roles) => (req, res, next) => {
  // Ensure user is authenticated
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  // Check if user's role is in denied roles
  if (roles.includes(req.user.role)) {
    console.warn(`[SECURITY] Role denied: User ${req.user._id} with role '${req.user.role}' is explicitly blocked from this route`);
    return res.status(403).json({
      success: false,
      message: 'Access denied: Role not authorized',
      code: 'ROLE_DENIED'
    });
  }

  next();
};