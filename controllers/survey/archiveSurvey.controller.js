// controllers/survey/archiveSurvey.controller.js
// ============================================================================
// Archive Survey Controller
// 
// Permission: survey:delete (reused — tech debt: create survey:archive later)
// Scope: Department-scoped (enforced by surveyPermissionMiddleware)
// Audit: Full audit logging
//
// Archive is the final terminal state. Archived surveys are read-only
// and preserved for historical/audit purposes.
// ============================================================================

const Logger = require("../../utils/auditLog");
const { validateStatusTransition } = require("../../utils/surveyStateMachine");

/**
 * Archive a survey (closed → archived)
 * Archived surveys are purely read-only. This is a terminal state.
 */
module.exports = async function archiveSurvey(req, res, next) {
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
        const transition = validateStatusTransition(survey.status, 'archived');
        if (!transition.valid) {
            return res.status(400).json({
                success: false,
                message: transition.message,
                code: "INVALID_STATUS_TRANSITION"
            });
        }

        const previousStatus = survey.status;
        survey.status = 'archived';
        await survey.save();

        await Logger.info("survey_archive", "Survey archived", {
            action: "survey:archive",
            surveyId: survey._id,
            tenantId: survey.tenant,
            departmentId: survey.department,
            userId: user._id,
            context: {
                previousStatus,
                newStatus: 'archived',
                userRole: user.role,
                surveyTitle: survey.title,
                totalResponses: survey.totalResponses
            },
            req
        });

        res.json({
            success: true,
            message: "Survey archived successfully",
            data: {
                surveyId: survey._id,
                status: survey.status
            }
        });

    } catch (err) {
        await Logger.error("survey_archive", "Survey archive failed", {
            action: "survey:archive",
            surveyId: req.params.surveyId || req.params.id,
            tenantId: req.user?.tenant,
            userId: req.user?._id,
            error: err.message,
            req
        });
        next(err);
    }
};
