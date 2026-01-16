// validators/feedbackValidator.js
const Joi = require("joi");

exports.analyzeSchema = Joi.object({
    responseIds: Joi.array().items(Joi.string().hex().length(24)).optional(),
    runAllUnanalyzed: Joi.boolean().optional().default(false),
});

exports.generateActionsSchema = Joi.object({
    feedbackIds: Joi.array().items(Joi.string().hex().length(24)).optional(),
    autoAssignTo: Joi.string().optional(),
});

exports.followUpSchema = Joi.object({
    actionIds: Joi.array().items(Joi.string().hex().length(24)).required(),
    messageTemplate: Joi.string().required(),
    method: Joi.string().valid("email", "sms", "both").default("email"),
});
