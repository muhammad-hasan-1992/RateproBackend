// controllers/survey/closeSurvey.controller.js
// ============================================================================
// Close Survey Controller
// 
// Permission: survey:deactivate (reused — tech debt: create survey:close later)
// Scope: Department-scoped (enforced by surveyPermissionMiddleware)
// Audit: Full audit logging
//
// Close vs Inactive:
//   - inactive = temporarily paused, can be re-activated
//   - closed = permanently stopped collecting responses, cannot reactivate
// ============================================================================

const Logger = require("../../utils/auditLog");
const { validateStatusTransition } = require("../../utils/surveyStateMachine");

/**
 * Close a survey permanently (active → closed)
 * Closed surveys can no longer accept responses or be re-activated.
 * They can only transition to "archived".
 */
module.exports = async function closeSurvey(req, res, next) {
    try {
        const survey = req.survey;
        const user = req.user;

        if (!survey) {
            return res.status(404).json({
                success: false,
                message: "Survey not found",
                code: "SURVEY_NOT_FOUND"
            });
        }

        // Guard: State machine transition check
        const transition = validateStatusTransition(survey.status, 'closed');
        if (!transition.valid) {
            return res.status(400).json({
                success: false,
                message: transition.message,
                code: "INVALID_STATUS_TRANSITION"
            });
        }

        const previousStatus = survey.status;
        survey.status = 'closed';
        await survey.save();

        await Logger.info("survey_close", "Survey closed", {
            action: "survey:close",
            surveyId: survey._id,
            tenantId: survey.tenant,
            departmentId: survey.department,
            userId: user._id,
            context: {
                previousStatus,
                newStatus: 'closed',
                userRole: user.role,
                surveyTitle: survey.title,
                totalResponses: survey.totalResponses
            },
            req
        });

        res.json({
            success: true,
            message: "Survey closed successfully. It will no longer accept responses.",
            data: {
                surveyId: survey._id,
                status: survey.status
            }
        });

    } catch (err) {
        await Logger.error("survey_close", "Survey close failed", {
            action: "survey:close",
            surveyId: req.params.surveyId || req.params.id,
            tenantId: req.user?.tenant,
            userId: req.user?._id,
            error: err.message,
            req
        });
        next(err);
    }
};
