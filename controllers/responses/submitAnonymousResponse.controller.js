// controllers/responses/submitAnonymousResponse.controller.js
const { submitResponseSchema } = require("../../validators/surveyResponseValidator");
const { handleAnonymousResponse } = require("../../services/responses/anonymousResponseService");

exports.submitAnonymousResponse = async (req, res, next) => {
  try {
    const { error, value } = submitResponseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const response = await handleAnonymousResponse({
      surveyId: req.params.surveyId,
      payload: value,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',  // NEW: Pass user agent
    });

    res.status(201).json({
      message: "Response submitted successfully",
      responseId: response._id,
    });
  } catch (err) {
    next(err);
  }
};