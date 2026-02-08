// controllers/survey/updateSurvey.controller.js
const Survey = require("../../models/Survey");
const { validateSurveyUpdate } = require("../../validators/surveyValidator");
const Logger = require("../../utils/auditLog");
const publishService = require("../../services/survey/publishService");

module.exports = async function updateSurvey(req, res, next) {
  const { surveyId } = req.params; // ✅ FIX: Move outside try block so it's accessible in catch

  try {
    const { error } = validateSurveyUpdate(req.body);
    if (error) return res.status(400).json({ message: error.details[0].message });

    const survey = await Survey.findOne({
      _id: surveyId,
      tenant: req.user.tenant,
      deleted: false,
    });

    if (!survey) {
      return res.status(404).json({ message: "Survey not found" });
    }

    // ✅ FIX: Detect draft → active transition and delegate to publish service
    const isPublishing = survey.status === "draft" && req.body.status === "active";

    if (isPublishing) {
      // ✅ FIX: Update survey data EXCEPT status (let publishService handle status change)
      const { status, ...dataWithoutStatus } = req.body;
      Object.assign(survey, dataWithoutStatus);
      await survey.save();

      // Now trigger full publish logic (emails, logs, snapshot)
      // Survey is still "draft" at this point, so publishService won't reject it
      const result = await publishService.publish({
        surveyId: survey._id,
        surveyData: null, // Use existing survey
        tenantId: req.user.tenant,
        userId: req.user._id
      });

      Logger.info("survey_publish", "Draft survey published via update", {
        context: {
          surveyId,
          tenantId: req.user.tenant,
          updatedBy: req.user._id,
          invitesCreated: result.invitesCreated
        },
        req
      });

      return res.json({
        message: "Survey published successfully",
        survey,
        invitesCreated: result.invitesCreated
      });
    }

    // Prevent editing published surveys (only draft surveys can be edited)
    if (survey.status !== "draft") {
      return res.status(403).json({
        message: "Only draft surveys can be edited. Published/active surveys are locked.",
      });
    }

    Object.assign(survey, req.body);
    await survey.save();

    Logger.info("survey_update", "Survey updated successfully", {
      context: {
        surveyId,
        tenantId: req.user.tenant,
        updatedBy: req.user._id
      },
      req
    });

    res.json({
      message: "Survey updated",
      survey,
    });

  } catch (err) {
    Logger.error("survey_update", "Survey update failed", {
      error: err,
      context: { surveyId, tenantId: req.user.tenant }, // ✅ Now surveyId is accessible
      req
    });
    next(err);
  }
};
