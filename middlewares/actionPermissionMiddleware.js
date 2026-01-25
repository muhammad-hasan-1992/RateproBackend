// middlewares/actionPermissionMiddleware.js
const Survey = require("../models/Survey");
const Action = require("../models/Action");

/**
 * Check if user has permission to access/modify actions from a specific survey
 * Uses survey-level permissions if enabled, otherwise allows role-based access
 */
const checkSurveyActionPermission = (permissionType = "view") => {
    return async (req, res, next) => {
        try {
            // Get action to find associated survey
            const actionId = req.params.id || req.params.actionId;
            if (!actionId) {
                return next(); // No action ID, proceed with role-based check
            }

            const action = await Action.findById(actionId)
                .select("metadata.surveyId tenant")
                .lean();

            if (!action) {
                return res.status(404).json({ success: false, message: "Action not found" });
            }

            // If no survey association, use role-based permissions
            const surveyId = action.metadata?.surveyId;
            if (!surveyId) {
                return next();
            }

            const survey = await Survey.findById(surveyId)
                .select("actionPermissions tenant")
                .lean();

            if (!survey || !survey.actionPermissions?.enabled) {
                return next(); // Survey permissions not enabled, use role-based
            }

            const perms = survey.actionPermissions;
            const userId = req.user._id.toString();
            const userRole = req.user.role;
            const userDepartment = req.user.department?.toString();

            // Admin always has access
            if (userRole === "admin") {
                return next();
            }

            // Check department restriction
            if (perms.restrictToDepartment && userDepartment !== perms.restrictToDepartment.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "You are not in the authorized department for actions from this survey"
                });
            }

            // Check permission type
            if (permissionType === "assign") {
                // Check if user is in allowedAssigners (empty = allow all with role permission)
                if (perms.allowedAssigners?.length > 0) {
                    const isAllowed = perms.allowedAssigners.some(id => id.toString() === userId);
                    if (!isAllowed && userRole !== "companyAdmin") {
                        return res.status(403).json({
                            success: false,
                            message: "You are not authorized to assign actions from this survey"
                        });
                    }
                }
            } else if (permissionType === "view") {
                // Check if user is in allowedViewers (empty = allow all with role permission)
                if (perms.allowedViewers?.length > 0) {
                    const isAllowed = perms.allowedViewers.some(id => id.toString() === userId);
                    if (!isAllowed && userRole !== "companyAdmin") {
                        return res.status(403).json({
                            success: false,
                            message: "You are not authorized to view actions from this survey"
                        });
                    }
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
