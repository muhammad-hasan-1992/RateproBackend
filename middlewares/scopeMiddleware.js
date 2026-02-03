// middlewares/scopeMiddleware.js
// ============================================================================
// Scope Enforcement Middleware for Multi-Tenant Authorization
// 
// This middleware ensures strict isolation between:
// - Platform Layer (System Admin only) - tenant management, plans, features
// - Tenant Layer (Company Admin + Member) - surveys, analytics, users, etc.
// 
// RULE: System Admin MUST NOT access tenant resources
// RULE: Tenant users MUST NOT access platform resources
// ============================================================================

/**
 * Enforce Platform Scope - Only System Admins can access
 * Use this on routes like: /api/admin-subscription, /api/plans, /api/features
 */
exports.enforcePlatformScope = (req, res, next) => {
    // Must be authenticated
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    // Only admin role can access platform resources
    if (req.user.role !== 'admin') {
        console.warn(`[SECURITY] Platform access denied for user ${req.user._id} with role ${req.user.role} on ${req.originalUrl}`);
        return res.status(403).json({
            success: false,
            message: 'Access denied: Platform admin access required',
            code: 'PLATFORM_ACCESS_DENIED'
        });
    }

    next();
};

/**
 * Enforce Tenant Scope - Only Tenant Users (companyAdmin, member) can access
 * Use this on routes like: /api/surveys, /api/analytics, /api/users
 * 
 * IMPORTANT: This explicitly BLOCKS system admin from tenant resources
 */
exports.enforceTenantScope = (req, res, next) => {
    // Must be authenticated
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    // System admin MUST NOT access tenant resources
    if (req.user.role === 'admin') {
        console.warn(`[SECURITY] Tenant access denied for admin user ${req.user._id} on ${req.originalUrl}`);
        return res.status(403).json({
            success: false,
            message: 'Access denied: System admins cannot access tenant resources',
            code: 'TENANT_ACCESS_DENIED'
        });
    }

    // Must have tenant context (set by setTenantId middleware)
    if (!req.tenantId) {
        console.warn(`[SECURITY] No tenant context for user ${req.user._id} on ${req.originalUrl}`);
        return res.status(403).json({
            success: false,
            message: 'Access denied: No tenant context available',
            code: 'NO_TENANT_CONTEXT'
        });
    }

    next();
};

/**
 * Enforce Company Admin Only - Subset of Tenant Scope
 * Only companyAdmin can access (e.g., billing, user management, access control)
 */
exports.enforceCompanyAdminOnly = (req, res, next) => {
    // Must be authenticated
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    // Block system admin
    if (req.user.role === 'admin') {
        console.warn(`[SECURITY] Tenant admin access denied for system admin ${req.user._id} on ${req.originalUrl}`);
        return res.status(403).json({
            success: false,
            message: 'Access denied: System admins cannot access tenant resources',
            code: 'TENANT_ACCESS_DENIED'
        });
    }

    // Must be companyAdmin
    if (req.user.role !== 'companyAdmin') {
        console.warn(`[SECURITY] Company admin access denied for ${req.user.role} user ${req.user._id} on ${req.originalUrl}`);
        return res.status(403).json({
            success: false,
            message: 'Access denied: Company admin access required',
            code: 'COMPANY_ADMIN_REQUIRED'
        });
    }

    // Must have tenant context
    if (!req.tenantId) {
        return res.status(403).json({
            success: false,
            message: 'Access denied: No tenant context available',
            code: 'NO_TENANT_CONTEXT'
        });
    }

    next();
};

/**
 * Allow Shared Access - All authenticated users (admin, companyAdmin, member)
 * Use for routes like profile, notifications that are available to everyone
 */
exports.allowSharedAccess = (req, res, next) => {
    // Must be authenticated
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    // Allow through - just needs to be logged in
    next();
};
