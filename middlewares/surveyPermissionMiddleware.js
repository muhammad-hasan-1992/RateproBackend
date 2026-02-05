// middlewares/surveyPermissionMiddleware.js
// ============================================================================
// Department-Scoped Survey Permission Middleware
// 
// Enforces permission-based access for survey actions (delete, activate, deactivate)
// with strict department-level scoping.
//
// Rules:
// - System Admin (role: 'admin') is BLOCKED from all survey actions
// - CompanyAdmin with crossDepartmentSurveyAccess=true can manage all surveys
// - CompanyAdmin with crossDepartmentSurveyAccess=false OR members can only
//   manage surveys within their department
// - Surveys with department=null are managed by CompanyAdmin only
// ============================================================================

const User = require("../models/User");
const Survey = require("../models/Survey");
const Permission = require("../models/Permission");
const PermissionAssignment = require("../models/PermissionAssignment");
const CustomRole = require("../models/CustomRole");

/**
 * Check if user has a specific permission via CustomRoles or PermissionAssignment
 */
async function hasPermission(user, permissionName, tenantId) {
    // Check via CustomRoles
    const populatedUser = await User.findById(user._id).populate({
        path: 'customRoles',
        match: { isActive: true, deleted: false },
        populate: { path: 'permissions', select: 'name' },
    });

    const hasRolePermission = populatedUser?.customRoles?.some((role) =>
        role.permissions?.some((perm) => perm.name === permissionName)
    );

    if (hasRolePermission) return true;

    // Check via PermissionAssignment
    const permissionDoc = await Permission.findOne({ name: permissionName });
    if (!permissionDoc) return false;

    const hasDirectPermission = await PermissionAssignment.findOne({
        userId: user._id,
        permissionId: permissionDoc._id,
        tenantId: tenantId,
    });

    return !!hasDirectPermission;
}

/**
 * Build department-scoped query filter for surveys
 * Returns a MongoDB query filter based on user's department access
 */
function getDepartmentFilter(user) {
    // CompanyAdmin with cross-department access can see all surveys
    if (user.role === 'companyAdmin' && user.crossDepartmentSurveyAccess === true) {
        return {}; // No department filter
    }

    // CompanyAdmin without cross-department access can manage:
    // - Surveys in their department (if they have one)
    // - Surveys with null department (company-level)
    if (user.role === 'companyAdmin') {
        if (user.department) {
            return { $or: [{ department: user.department }, { department: null }] };
        }
        return { department: null };
    }

    // Members can only manage surveys in their department
    if (user.department) {
        return { department: user.department };
    }

    // No department = no access for members
    return { department: { $exists: false } }; // Matches nothing
}

/**
 * Survey Permission Middleware Factory
 * Creates middleware that checks:
 * 1. User is NOT System Admin
 * 2. User has required permission
 * 3. User has department access to the survey (if surveyId in params)
 */
exports.surveyPermission = (requiredPermission) => async (req, res, next) => {
    try {
        const user = req.user;

        // 1. Block System Admin from ALL survey actions
        if (user.role === 'admin') {
            console.warn(`[SECURITY] Survey action denied for System Admin ${user._id} on ${req.originalUrl}`);
            return res.status(403).json({
                success: false,
                message: 'Access denied: System admins cannot perform survey actions',
                code: 'SURVEY_ACTION_DENIED'
            });
        }

        // 2. Ensure tenant context exists
        const tenantId = req.tenantId || user.tenant?._id || user.tenant;
        if (!tenantId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: No tenant context',
                code: 'NO_TENANT_CONTEXT'
            });
        }

        // 3. Check if user has the required permission
        // CompanyAdmin implicitly has permissions (can be changed to explicit if needed)
        const hasRequiredPermission = user.role === 'companyAdmin' ||
            await hasPermission(user, requiredPermission, tenantId);

        if (!hasRequiredPermission) {
            console.warn(`[SECURITY] Permission denied for user ${user._id}: missing ${requiredPermission}`);
            return res.status(403).json({
                success: false,
                message: `Permission denied: ${requiredPermission} required`,
                code: 'PERMISSION_DENIED'
            });
        }

        // 4. If surveyId in params, verify department access
        const surveyId = req.params.surveyId || req.params.id;
        if (surveyId) {
            const departmentFilter = getDepartmentFilter(user);

            const survey = await Survey.findOne({
                _id: surveyId,
                tenant: tenantId,
                deleted: false,
                ...departmentFilter
            });

            if (!survey) {
                // Either survey doesn't exist or user doesn't have department access
                return res.status(404).json({
                    success: false,
                    message: 'Survey not found',
                    code: 'SURVEY_NOT_FOUND'
                });
            }

            // Attach survey to request for controller use
            req.survey = survey;
        }

        // 5. Attach department filter function for list endpoints
        req.getDepartmentFilter = () => getDepartmentFilter(user);

        next();
    } catch (error) {
        console.error('[surveyPermission] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            code: 'INTERNAL_ERROR'
        });
    }
};

/**
 * Export helper for use in controllers
 */
exports.getDepartmentFilter = getDepartmentFilter;
