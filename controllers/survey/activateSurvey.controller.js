// controllers/survey/activateSurvey.controller.js
// ============================================================================
// Activate Survey Controller
// 
// Permission: survey:activate
// Scope: Department-scoped (enforced by surveyPermissionMiddleware)
// Audit: Full audit logging with action, survey, tenant, department, user
// ============================================================================

const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");

/**
 * Activate a survey (set status to 'active')
 * 
 * Prerequisites (enforced by middleware):
 * - User is authenticated
 * - User is NOT System Admin
 * - User has survey:activate permission
 * - User has department access to the survey
 * 
 * @param {Request} req - Express request (req.survey pre-loaded by middleware)
 * @param {Response} res - Express response
 */
module.exports = async function activateSurvey(req, res, next) {
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

        // Check if already active
        if (survey.status === 'active') {
            return res.status(400).json({
                success: false,
                message: "Survey is already active",
                code: "SURVEY_ALREADY_ACTIVE"
            });
        }

        // Update status
        const previousStatus = survey.status;
        survey.status = 'active';
        await survey.save();

        // Audit log with all required fields
        await Logger.info("survey_activate", "Survey activated", {
            action: "survey:activate",
            surveyId: survey._id,
            tenantId: survey.tenant,
            departmentId: survey.department,
            userId: user._id,
            context: {
                previousStatus,
                newStatus: 'active',
                userRole: user.role,
                surveyTitle: survey.title
            },
            req
        });

        res.json({
            success: true,
            message: "Survey activated successfully",
            data: {
                surveyId: survey._id,
                status: survey.status
            }
        });

    } catch (err) {
        await Logger.error("survey_activate", "Survey activation failed", {
            action: "survey:activate",
            surveyId: req.params.surveyId || req.params.id,
            tenantId: req.user?.tenant,
            userId: req.user?._id,
            error: err.message,
            req
        });
        next(err);
    }
};
