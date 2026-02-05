// controllers/survey/deleteSurvey.controller.js
// ============================================================================
// Delete Survey Controller (Soft Delete)
// 
// Permission: survey:delete
// Scope: Department-scoped (enforced by surveyPermissionMiddleware)
// Audit: Full audit logging with action, survey, tenant, department, user
// ============================================================================

const Survey = require("../../models/Survey");
const Logger = require("../../utils/auditLog");

/**
 * Soft-delete a survey (set deleted=true, status='inactive')
 * 
 * Prerequisites (enforced by middleware):
 * - User is authenticated
 * - User is NOT System Admin
 * - User has survey:delete permission
 * - User has department access to the survey
 * 
 * @param {Request} req - Express request (req.survey pre-loaded by middleware)
 * @param {Response} res - Express response
 */
module.exports = async function deleteSurvey(req, res, next) {
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

    // Check if already deleted
    if (survey.deleted) {
      return res.status(400).json({
        success: false,
        message: "Survey is already deleted",
        code: "SURVEY_ALREADY_DELETED"
      });
    }

    // Capture data before deletion for audit
    const surveyData = {
      title: survey.title,
      previousStatus: survey.status,
      department: survey.department,
      tenant: survey.tenant,
      createdBy: survey.createdBy
    };

    // Soft delete
    survey.deleted = true;
    survey.status = "inactive";
    await survey.save();

    // Audit log with all required fields (immutable record)
    await Logger.info("survey_delete", "Survey soft-deleted", {
      action: "survey:delete",
      surveyId: survey._id,
      tenantId: survey.tenant,
      departmentId: survey.department,
      userId: user._id,
      context: {
        surveyTitle: surveyData.title,
        previousStatus: surveyData.previousStatus,
        userRole: user.role,
        userDepartment: user.department,
        deletedAt: new Date().toISOString()
      },
      req
    });

    res.json({
      success: true,
      message: "Survey deleted successfully",
      data: {
        surveyId: survey._id
      }
    });

  } catch (err) {
    await Logger.error("survey_delete", "Survey delete failed", {
      action: "survey:delete",
      surveyId: req.params.surveyId || req.params.id,
      tenantId: req.user?.tenant,
      userId: req.user?._id,
      error: err.message,
      req
    });
    next(err);
  }
};