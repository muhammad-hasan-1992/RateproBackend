// controllers/responses/submittedInvitedResponse.controller.js
const { submitResponseSchema } = require("../../validators/surveyResponseValidator");
const { submitResponseService } = require("../../services/responses/submitResponseService");

exports.submitInvitedResponse = async (req, res, next) => {
  try {
    const { error, value } = submitResponseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const response = await submitResponseService({
      token: req.params.token,
      payload: value,
    });

    res.status(201).json({
      message: "Response submitted successfully",
      responseId: response._id,
    });
  } catch (err) {
    next(err);
  }
};