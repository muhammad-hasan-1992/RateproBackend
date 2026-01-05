// controllers/survey/scheduleSurvey.controller.js
const Survey = require("../../models/Survey");
const schedulingService = require("../../services/survey/SchedulingService");
const { scheduleValidator } = require("../../validators/scheduleValidator");
const Logger = require("../../utils/auditLog");

exports.scheduleSurvey = async (req, res, next) => {
  try {
    const { error } = scheduleValidator.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { surveyId } = req.params;
    const tenantId = req.user.tenant;

    const survey = await Survey.findOne({
      _id: surveyId,
      tenant: tenantId,
      deleted: false
    });

    if (!survey) {
      return res.status(404).json({ message: "Survey not found" });
    }

    // Guards
    if (!survey.targetAudience || !survey.targetAudience.audienceType) {
      return res.status(400).json({ message: "Set target audience first" });
    }

    if (survey.status === "active") {
      return res.status(400).json({ message: "Active survey cannot be rescheduled" });
    }

    // Perform scheduling
    const updatedSurvey = await schedulingService.applySchedule(survey, req.body);

    await updatedSurvey.save();

    res.json({
      message: "Survey scheduled successfully",
      status: updatedSurvey.status,
      schedule: updatedSurvey.schedule
    });

  } catch (err) {
    next(err);
  }
};
