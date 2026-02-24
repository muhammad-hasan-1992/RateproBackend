// controllers/survey/createSurvey.controller.js

const Survey = require("../../models/Survey");
const User = require("../../models/User");
const { validateSurveyCreate } = require("../../validators/surveyValidator");
const Logger = require("../../utils/auditLog");

module.exports = async function createSurvey(req, res, next) {
  try {
    const { error } = validateSurveyCreate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const { targetAudience, publishSettings, responsibleUserId, ...surveyData } = req.body;

    // ── Validate responsibleUserId (FIX #4: Full security check) ──────
    let validatedResponsibleUserId = null;
    if (responsibleUserId) {
      const assignedUser = await User.findOne({
        _id: responsibleUserId,
        tenant: req.user.tenant,
        isActive: true,
        deleted: false,
        role: { $in: ['companyAdmin', 'member'] }
      });
      if (!assignedUser) {
        return res.status(400).json({
          message: 'Invalid responsible user: must be an active member or company admin in the same tenant'
        });
      }
      validatedResponsibleUserId = assignedUser._id;
    }

    // Transform targetAudience array to object format if needed
    let audienceObj = { audienceType: "custom", categories: [], users: [], contacts: [] };

    if (Array.isArray(targetAudience)) {
      // Frontend sends array like ["customers", "employees"]
      if (targetAudience.includes("all")) {
        audienceObj.audienceType = "all";
      } else {
        audienceObj.audienceType = "custom";
        // Map audience types - you may need to adjust based on your actual data
        // This is a placeholder - real implementation depends on how frontend sends data
      }
    } else if (targetAudience && typeof targetAudience === "object") {
      audienceObj = targetAudience;
    }

    // Build schedule from publishSettings
    let schedule = {};
    if (publishSettings) {
      if (publishSettings.publishNow) {
        schedule.publishedAt = new Date();
        schedule.startDate = new Date();
      } else if (publishSettings.scheduleDate) {
        const startDate = publishSettings.scheduleTime
          ? new Date(`${publishSettings.scheduleDate}T${publishSettings.scheduleTime}`)
          : new Date(publishSettings.scheduleDate);
        schedule.startDate = startDate;
        schedule.autoPublish = true;
      }
      if (publishSettings.expiryDate) {
        schedule.endDate = new Date(publishSettings.expiryDate);
      }
    }

    const survey = new Survey({
      ...surveyData,
      targetAudience: audienceObj,
      schedule,
      tenant: req.user.tenant,
      createdBy: req.user._id,
      responsibleUserId: validatedResponsibleUserId,
      deleted: false
    });

    await survey.save();

    Logger.info("survey_create", "Survey created successfully", {
      context: {
        surveyId: survey._id,
        tenantId: req.user.tenant,
        createdBy: req.user._id,
        status: survey.status
      },
      req
    });

    res.status(201).json({
      message: "Survey created",
      survey,
    });

  } catch (err) {
    Logger.error("survey_create", "Survey creation failed", {
      error: err,
      context: { tenantId: req.user.tenant, body: req.body },
      req
    });
    next(err);
  }
};