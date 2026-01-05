// controllers/responses/submittedInvitedResponse.controller.js
const { submitResponseSchema } = require("../../validators/surveyResponseValidator");
const { submitSurveyResponseService } = require("../../services/responses/submitResponseService");

exports.submitInvitedResponse = async (req, res, next) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📩 [SubmitInvitedResponse Controller] INCOMING REQUEST`);
  console.log(`   Token: ${req.params.token?.substring(0, 12)}...`);
  console.log(`   IP: ${req.ip}`);
  console.log(`   Body keys: ${Object.keys(req.body || {}).join(', ')}`);
  console.log(`${'='.repeat(60)}`);

  try {
    console.log(`\n🔍 [Validation] Checking payload...`);
    const { error, value } = submitResponseSchema.validate(req.body);
    if (error) {
      console.error(`   ❌ Validation failed: ${error.details[0].message}`);
      return res.status(400).json({ message: error.details[0].message });
    }
    console.log(`   ✅ Payload valid`);
    console.log(`   Answers: ${value.answers?.length || 0}`);

    console.log(`\n🚀 [Submit] Calling service...`);
    const response = await submitSurveyResponseService({
      token: req.params.token,
      payload: value,
      ip: req.ip
    });

    console.log(`\n✅ [SubmitInvitedResponse Controller] SUCCESS`);
    console.log(`   Response ID: ${response._id}`);
    console.log(`${'='.repeat(60)}\n`);

    res.status(201).json({
      message: "Response submitted successfully",
      responseId: response._id,
    });
  } catch (err) {
    console.error(`\n❌ [SubmitInvitedResponse Controller] ERROR`);
    console.error(`   Message: ${err.message}`);
    console.error(`${'='.repeat(60)}\n`);
    next(err);
  }
};