// /validators/surveyValidators.js
const Joi = require("joi");

exports.validateSurveyCreate = (data) => {
  const schema = Joi.object({
    title: Joi.string().required(),
    description: Joi.string().allow("", null),
    category: Joi.string().allow("", null),
    language: Joi.alternatives().try(
      Joi.string(),                              // Single string like "en", "ar", "English"
      Joi.array().items(Joi.string())            // Array like ["English", "Arabic"]
    ).default("en"),
    themeColor: Joi.string().allow("", null),

    questions: Joi.array().items(Joi.object({
      id: Joi.alternatives().try(Joi.string(), Joi.number()).allow("", null),
      questionText: Joi.string().allow("", null), // Made optional - some questions may not have text yet
      title: Joi.string().allow("", null), // Frontend might send 'title' instead
      type: Joi.string().required(),
      options: Joi.array().items(
        Joi.alternatives().try(
          Joi.string(),
          Joi.object() // Frontend might send option objects
        )
      ).default([]),
      required: Joi.boolean().default(false),
      description: Joi.string().allow("", null),
      settings: Joi.object().unknown(true).default({}),
      logicRules: Joi.array().default([]),
      translations: Joi.object().default({})
    }).unknown(true)).default([]), // Allow unknown fields in questions

    settings: Joi.object({
      isPublic: Joi.boolean().default(true),
      isAnonymous: Joi.boolean().default(false),
      collectEmail: Joi.boolean().default(false),
      multipleResponses: Joi.boolean().default(false),
      isPasswordProtected: Joi.boolean().default(false),
      password: Joi.string().allow("", null)
    }).unknown(true).default({}), // Allow unknown fields in settings

    sections: Joi.array().default([]),
    translations: Joi.object().default({}),

    // Thank you page - made more flexible
    thankYouPage: Joi.object({
      message: Joi.string().allow("", null),
      redirectUrl: Joi.string().allow("", null), // Removed .uri() - too strict
      qrCode: Joi.object().unknown(true).default({})
    }).unknown(true).default({}),

    // Branding
    branding: Joi.object().unknown(true).default({}),

    // Target Audience - more flexible
    targetAudience: Joi.alternatives().try(
      Joi.array().items(Joi.any()),  // Array of anything
      Joi.object().unknown(true)     // Object with any fields
    ).default([]),

    // Publish Settings
    publishSettings: Joi.object({
      publishNow: Joi.boolean().default(false),
      scheduleDate: Joi.alternatives().try(Joi.date(), Joi.string()).allow(null),
      scheduleTime: Joi.string().allow("", null),
      expiryDate: Joi.alternatives().try(Joi.date(), Joi.string()).allow(null),
      maxResponses: Joi.number().allow(null)
    }).unknown(true).default({}),

    // Status
    status: Joi.string().valid("draft", "active", "scheduled", "inactive", "closed", "published").default("draft"),

    // Metadata
    metadata: Joi.object().unknown(true).default({})

  }).options({ stripUnknown: false, allowUnknown: true }); // Allow any extra fields

  return schema.validate(data);
};

exports.validateSurveyUpdate = (data) => {
  const schema = Joi.object({
    title: Joi.string().optional(),
    description: Joi.string().allow("", null).optional(),
    category: Joi.string().allow("", null).optional(),
    language: Joi.string().valid("en", "ar").default("en"),
    themeColor: Joi.string().allow("", null).optional(),
    questions: Joi.array().items(Joi.object().unknown(true)).optional(),
    settings: Joi.object().unknown(true).optional(),
    sections: Joi.array().optional(),
    translations: Joi.object().optional(),
    thankYouPage: Joi.object().unknown(true).optional(),
    branding: Joi.object().unknown(true).optional(),
    targetAudience: Joi.alternatives().try(
      Joi.array(),
      Joi.object()
    ).optional(),
    publishSettings: Joi.object().unknown(true).optional(),
    status: Joi.string().valid("draft", "active", "scheduled", "inactive", "closed", "published").optional(),
    metadata: Joi.object().unknown(true).optional()
  }).options({ stripUnknown: false, allowUnknown: true });

  return schema.validate(data);
};