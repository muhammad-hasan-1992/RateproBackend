// middlewares/actionPermissionMiddleware.js
const Survey = require("../models/Survey");
const Action = require("../models/Action");
const Permission = require("../models/Permission");
const PermissionAssignment = require("../models/PermissionAssignment");

/**
 * Check if user has a specific permission
 */
const hasPermission = async (userId, permissionName, tenantId) => {
    const permission = await Permission.findOne({ name: permissionName });
    if (!permission) return false;

    const assignment = await PermissionAssignment.findOne({
        userId,
        permissionId: permission._id,
        tenantId
    });

    return !!assignment;
};

/**
 * Check if user has permission to access/modify actions from a specific survey
 * Enhanced with:
 * - System Admin blocking
 * - Permission-based checks (surveyAction:view, surveyAction:assign)
 * - actionManager field validation
 */
const checkSurveyActionPermission = (permissionType = "view") => {
    return async (req, res, next) => {
        try {
            const user = req.user;
            const userRole = user.role;
            const userId = user._id.toString();
            const tenantId = user.tenant?._id || user.tenant;

            // System Admin BLOCKED from tenant actions
            if (userRole === "admin") {
                return res.status(403).json({
                    success: false,
                    message: "System Admin cannot manage tenant actions"
                });
            }

            // CompanyAdmin bypasses permission checks (still tenant-scoped)
            if (userRole === "companyAdmin") {
                return next();
            }

            // Check if user has the required permission
            const permissionName = permissionType === "assign"
                ? "surveyAction:assign"
                : "surveyAction:view";

            const hasRequiredPermission = await hasPermission(userId, permissionName, tenantId);
            if (!hasRequiredPermission) {
                return res.status(403).json({
                    success: false,
                    message: `Permission denied: ${permissionName} required`
                });
            }

            // Get action to find associated survey
            const actionId = req.params.id || req.params.actionId;
            if (!actionId) {
                return next(); // No action ID, proceed
            }

            const action = await Action.findById(actionId)
                .select("metadata.surveyId tenant")
                .lean();

            if (!action) {
                return res.status(404).json({ success: false, message: "Action not found" });
            }

            // If no survey association, allow (general action)
            const surveyId = action.metadata?.surveyId;
            if (!surveyId) {
                return next();
            }

            const survey = await Survey.findById(surveyId)
                .select("actionPermissions actionManager tenant")
                .lean();

            if (!survey) {
                return next();
            }

            // For assignment permission, check actionManager
            if (permissionType === "assign") {
                const isActionManager = survey.actionManager &&
                    survey.actionManager.toString() === userId;

                // Check cross-survey access flag (reusing existing field)
                const hasCrossSurveyAccess = user.crossDepartmentSurveyAccess === true;

                if (!isActionManager && !hasCrossSurveyAccess) {
                    // Check legacy allowedAssigners array
                    const perms = survey.actionPermissions;
                    if (perms?.enabled && perms?.allowedAssigners?.length > 0) {
                        const isAllowed = perms.allowedAssigners.some(id => id.toString() === userId);
                        if (!isAllowed) {
                            return res.status(403).json({
                                success: false,
                                message: "You can only assign actions for surveys you manage"
                            });
                        }
                    } else if (!isActionManager) {
                        return res.status(403).json({
                            success: false,
                            message: "You can only assign actions for surveys you manage"
                        });
                    }
                }
            }

            // Legacy department restriction check
            const perms = survey.actionPermissions;
            if (perms?.enabled && perms?.restrictToDepartment) {
                const userDepartment = user.department?.toString();
                if (userDepartment !== perms.restrictToDepartment.toString()) {
                    return res.status(403).json({
                        success: false,
                        message: "You are not in the authorized department for actions from this survey"
                    });
                }
            }

            next();
        } catch (error) {
            console.error("actionPermissionMiddleware error:", error);
            next(error);
        }
    };
};

/**
 * Filter actions list based on survey permissions
 * Call this after fetching actions to filter out restricted ones
 */
const filterActionsBySurveyPermission = async (actions, userId, userRole, userDepartment) => {
    if (userRole === "admin") return actions;

    const surveyIds = [...new Set(
        actions.filter(a => a.metadata?.surveyId).map(a => a.metadata.surveyId.toString())
    )];

    if (surveyIds.length === 0) return actions;

    const surveys = await Survey.find({
        _id: { $in: surveyIds },
        "actionPermissions.enabled": true
    }).select("_id actionPermissions").lean();

    const surveyPermMap = new Map(surveys.map(s => [s._id.toString(), s.actionPermissions]));

    return actions.filter(action => {
        const surveyId = action.metadata?.surveyId?.toString();
        if (!surveyId) return true;

        const perms = surveyPermMap.get(surveyId);
        if (!perms) return true;

        // Department check
        if (perms.restrictToDepartment && userDepartment !== perms.restrictToDepartment.toString()) {
            return false;
        }

        // Viewer check
        if (perms.allowedViewers?.length > 0) {
            const isAllowed = perms.allowedViewers.some(id => id.toString() === userId);
            return isAllowed || userRole === "companyAdmin";
        }

        return true;
    });
};

module.exports = {
    checkSurveyActionPermission,
    filterActionsBySurveyPermission
};
