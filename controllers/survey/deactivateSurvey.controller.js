// controllers/survey/deactivateSurvey.controller.js
// ============================================================================
// Deactivate Survey Controller
// 
// Permission: survey:deactivate
// Scope: Department-scoped (enforced by surveyPermissionMiddleware)
// Audit: Full audit logging with action, survey, tenant, department, user
// ============================================================================

const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");

/**
 * Deactivate a survey (set status to 'inactive')
 * 
 * Prerequisites (enforced by middleware):
 * - User is authenticated
 * - User is NOT System Admin
 * - User has survey:deactivate permission
 * - User has department access to the survey
 * 
 * @param {Request} req - Express request (req.survey pre-loaded by middleware)
 * @param {Response} res - Express response
 */
module.exports = async function deactivateSurvey(req, res, next) {
    try {
        // Survey is pre-loaded and validated by surveyPermissionMiddleware
        const survey = req.survey;
        const user = req.user;

        if (!survey) {
            return res.status(404).json({
                success: false,
                message: "Survey not found",
                code: "SURVEY_NOT_FOUND"
            });
        }

        // Check if already inactive
        if (survey.status === 'inactive') {
            return res.status(400).json({
                success: false,
                message: "Survey is already inactive",
                code: "SURVEY_ALREADY_INACTIVE"
            });
        }

        // Update status
        const previousStatus = survey.status;
        survey.status = 'inactive';
        await survey.save();

        // Audit log with all required fields
        await Logger.info("survey_deactivate", "Survey deactivated", {
            action: "survey:deactivate",
            surveyId: survey._id,
            tenantId: survey.tenant,
            departmentId: survey.department,
            userId: user._id,
            context: {
                previousStatus,
                newStatus: 'inactive',
                userRole: user.role,
                surveyTitle: survey.title
            },
            req
        });

        res.json({
            success: true,
            message: "Survey deactivated successfully",
            data: {
                surveyId: survey._id,
                status: survey.status
            }
        });

    } catch (err) {
        await Logger.error("survey_deactivate", "Survey deactivation failed", {
            action: "survey:deactivate",
            surveyId: req.params.surveyId || req.params.id,
            tenantId: req.user?.tenant,
            userId: req.user?._id,
            error: err.message,
            req
        });
        next(err);
    }
};
