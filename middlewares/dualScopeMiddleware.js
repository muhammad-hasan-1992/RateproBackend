// middlewares/dualScopeMiddleware.js
// ============================================================================
// Dual-Scope Authorization Middleware for Multi-Tenant RBAC
// 
// Single responsibility: enforces tenant ownership for dual-scope routes
// where Platform Admin has global access and tenant users are restricted
// to their own tenant.
//
// Use validateObjectId() BEFORE this middleware to validate param format.
// ============================================================================

const Logger = require("../utils/logger");

/**
 * Creates a dual-scope middleware that allows:
 * - Platform admin → full access (any tenant)
 * - Tenant users → only their own tenant
 * 
 * @param {Object} options
 * @param {string} options.tenantParam - req.params key for tenant ID (default: 'id')
 * @param {string[]} options.allowedRoles - Tenant roles allowed (default: ['companyAdmin', 'member'])
 * @returns {Function} Express middleware
 * 
 * @example
 * // GET /tenants/:id — admin: any, companyAdmin/member: own only
 * router.get('/:id', protect, validateObjectId('id'), enforceTenantOwnership(), getTenant);
 * 
 * // PUT /tenants/:tenantId — admin: any, companyAdmin: own only
 * router.put('/:tenantId', protect, validateObjectId('tenantId'),
 *   enforceTenantOwnership({ tenantParam: 'tenantId', allowedRoles: ['companyAdmin'] }),
 *   updateTenant);
 */
exports.enforceTenantOwnership = (options = {}) => {
    const { tenantParam = 'id', allowedRoles = ['companyAdmin', 'member'] } = options;

    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        // Platform admin → full access to any tenant
        if (req.user.role === 'admin') {
            return next();
        }

        // Tenant users → ownership check
        if (allowedRoles.includes(req.user.role)) {
            const userTenantId = req.user.tenant?._id?.toString() || req.user.tenant?.toString();
            const requestedTenantId = req.params[tenantParam];

            // No tenant associated with user account
            if (!userTenantId) {
                Logger.warn("enforceTenantOwnership", "NO_TENANT_ASSOCIATION", {
                    context: {
                        userId: req.user._id,
                        route: req.originalUrl
                    },
                    req
                });
                return res.status(403).json({
                    success: false,
                    message: 'Access denied: No tenant associated with your account',
                    code: 'NO_TENANT_ASSOCIATION'
                });
            }

            // Tenant matches → allow
            if (userTenantId === requestedTenantId) {
                return next();
            }

            // Cross-tenant access attempt
            Logger.warn("enforceTenantOwnership", "TENANT_OWNERSHIP_DENIED", {
                context: {
                    userId: req.user._id,
                    userTenant: userTenantId,
                    requestedTenant: requestedTenantId,
                    route: req.originalUrl
                },
                req
            });
            return res.status(403).json({
                success: false,
                message: 'Access denied: You can only access your own tenant',
                code: 'TENANT_OWNERSHIP_DENIED'
            });
        }

        // All other roles → denied
        Logger.warn("enforceTenantOwnership", "ACCESS_DENIED", {
            context: {
                userId: req.user._id,
                role: req.user.role,
                route: req.originalUrl
            },
            req
        });
        return res.status(403).json({
            success: false,
            message: 'Access denied: Insufficient privileges',
            code: 'ACCESS_DENIED'
        });
    };
};
