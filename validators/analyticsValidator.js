// validators/analyticsValidator.js
const Joi = require("joi");

exports.analyticsValidator = Joi.object({
  surveyId: Joi.string().hex().length(24).required(),
});

exports.rangeValidator = Joi.object({
  range: Joi.string().pattern(/^\d+d$/).default('30d')
});

exports.surveyStatsValidator = Joi.object({
  surveyId: Joi.string().hex().length(24).required()
});
