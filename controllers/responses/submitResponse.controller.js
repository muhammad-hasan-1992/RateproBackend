const { submitResponseSchema } = require("../../validators/surveyResponseValidator");
const { submitSurveyResponseService } = require("../../services/responses/submitResponseService");

exports.submitSurveyResponse = async (req, res, next) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📩 [SubmitResponse Controller] INCOMING REQUEST`);
  console.log(`   Token: ${req.params.token?.substring(0, 12)}...`);
  console.log(`   IP: ${req.ip}`);
  console.log(`   User: ${req.user?._id || 'Not authenticated'}`);
  console.log(`   Body keys: ${Object.keys(req.body || {}).join(', ')}`);
  console.log(`${'='.repeat(60)}`);

  try {
    const { token } = req.params;

    // 1️⃣ Validate payload
    console.log(`\n🔍 [Validation] Checking payload...`);
    const { error, value } = submitResponseSchema.validate(req.body);
    if (error) {
      console.error(`   ❌ Validation failed: ${error.message}`);
      return res.status(400).json({ message: error.message });
    }
    console.log(`   ✅ Payload valid`);
    console.log(`   Answers: ${value.answers?.length || 0}`);
    console.log(`   Rating: ${value.rating || 'N/A'}`);
    console.log(`   Score: ${value.score || 'N/A'}`);
    console.log(`   isAnonymous: ${value.isAnonymous || false}`);

    // 2️⃣ Submit response
    console.log(`\n🚀 [Submit] Calling service...`);
    await submitSurveyResponseService({
      token,
      payload: value,
      ip: req.ip,
      user: req.user
    });

    console.log(`\n✅ [SubmitResponse Controller] SUCCESS`);
    console.log(`${'='.repeat(60)}\n`);

    res.status(201).json({
      message: "Survey response submitted successfully"
    });

  } catch (err) {
    console.error(`\n❌ [SubmitResponse Controller] ERROR`);
    console.error(`   Message: ${err.message}`);
    
    if (err.message === "INVALID_INVITE_TOKEN") {
      console.error(`   → Returning 404`);
      return res.status(404).json({ message: "Invalid or expired survey link" });
    }

    if (err.message === "SURVEY_ALREADY_SUBMITTED") {
      console.error(`   → Returning 409`);
      return res.status(409).json({ message: "Survey already submitted" });
    }

    console.error(`   → Passing to error handler`);
    console.error(`${'='.repeat(60)}\n`);
    next(err);
  }
};
