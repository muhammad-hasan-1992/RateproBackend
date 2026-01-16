// validators/actionValidator.js
const Joi = require("joi");

exports.createActionSchema = Joi.object({
    feedbackId: Joi.string().hex().length(24).optional(),
    title: Joi.string().min(3).optional().allow(''),
    description: Joi.string().min(5).required(),
    priority: Joi.string().valid("high", "medium", "low", "long-term").required(),
    assignedTo: Joi.string().hex().length(24).optional().allow(null),
    team: Joi.string().min(2).optional().allow(null),
    dueDate: Joi.date().optional().allow(null),
    tags: Joi.array().items(Joi.string()).optional(),
    category: Joi.string().optional(),
    source: Joi.string().valid("manual", "survey_feedback", "ai_generated").optional()
});

exports.updateActionSchema = Joi.object({
    description: Joi.string().min(5).optional(),
    priority: Joi.string().valid("high", "medium", "low", "long-term").optional(),
    assignedTo: Joi.string().hex().length(24).allow(null).optional(),
    team: Joi.string().min(2).allow(null).optional(),
    status: Joi.string().valid("pending", "open", "in-progress", "resolved").optional(),
    dueDate: Joi.date().allow(null).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    category: Joi.string().optional(),
    resolution: Joi.string().optional()
});

exports.bulkUpdateSchema = Joi.object({
    actionIds: Joi.array().items(Joi.string().hex().length(24)).min(1).required(),
    updates: Joi.object({
        priority: Joi.string().valid("high", "medium", "low", "long-term").optional(),
        status: Joi.string().valid("pending", "open", "in-progress", "resolved").optional(),
        assignedTo: Joi.string().hex().length(24).allow(null).optional(),
        team: Joi.string().optional().allow(null)
    }).min(1).required()
});

exports.assignActionSchema = Joi.object({
    assignedTo: Joi.string().hex().length(24).optional().allow(null),
    team: Joi.string().min(2).optional().allow(null)
});
