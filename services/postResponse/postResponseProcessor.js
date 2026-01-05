// services/postResponse/postResponseProcessor.js
const analyticsService = require("../analytics/analyticsService");
const aiInsightService = require("../ai/aiInsightService");
const autoActionService = require("../actions/autoActionService");
const notificationService = require("../notifications/notificationService");
const Logger = require("../../utils/auditLog");

exports.processPostSurveyResponse = async ({
  response,
  survey,
  tenantId
}) => {
  const responseId = response?._id || response?.id || 'unknown';
  const surveyId = survey?._id || survey?.id || 'unknown';
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🔄 [PostResponseProcessor] STARTED`);
  console.log(`   Response ID: ${responseId}`);
  console.log(`   Survey ID: ${surveyId}`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log(`${'─'.repeat(60)}`);

  try {
    Logger.info("Post-response processing started", {
      responseId: response._id,
      surveyId: survey._id
    });

    // 🔹 1. Analytics (non-blocking)
    console.log(`\n📊 [Step 1/4] Updating analytics (async)...`);
    analyticsService
      .updateSurveyAnalytics({ response, survey })
      .then(() => console.log(`   ✅ Analytics updated successfully`))
      .catch(err => {
        console.error(`   ❌ Analytics update failed:`, err.message);
        Logger.error("Analytics update failed", { err: err.message });
      });

    // 🔹 2. AI Insight
    console.log(`\n🤖 [Step 2/4] Running AI analysis...`);
    const startAI = Date.now();
    const insight = await aiInsightService.analyzeResponse({
      response,
      survey
    });
    console.log(`   ✅ AI analysis completed in ${Date.now() - startAI}ms`);
    console.log(`   Sentiment: ${insight?.sentiment || 'N/A'}`);
    console.log(`   Urgency: ${insight?.urgency || 'N/A'}`);
    console.log(`   Should generate action: ${insight?.shouldGenerateAction || false}`);

    // 🔹 3. Auto Action (conditional)
    console.log(`\n⚡ [Step 3/4] Checking action rules...`);
    if (insight.shouldGenerateAction) {
      console.log(`   → Creating action from insight...`);
      const action = await autoActionService.createActionFromInsight({
        insight,
        response,
        survey,
        tenantId
      });
      console.log(`   ✅ Action created: ${action?._id}`);
      console.log(`   Priority: ${action?.priority}`);

      // 🔹 4. Notify managers if urgent
      console.log(`\n🔔 [Step 4/4] Checking notifications...`);
      if (action.priority === "high") {
        console.log(`   → Sending urgent notification...`);
        notificationService.notifyUrgentAction(action)
          .then(() => console.log(`   ✅ Notification sent`))
          .catch((err) => console.error(`   ❌ Notification failed:`, err.message));
      } else {
        console.log(`   ℹ️ Priority is "${action.priority}", skipping notification`);
      }
    } else {
      console.log(`   ℹ️ No action needed based on insight`);
      console.log(`\n🔔 [Step 4/4] Skipped (no action created)`);
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ [PostResponseProcessor] COMPLETED`);
    console.log(`   Response ID: ${responseId}`);
    console.log(`${'─'.repeat(60)}\n`);

    Logger.info("Post-response processing completed", {
      responseId: response._id
    });

  } catch (error) {
    console.error(`\n${'─'.repeat(60)}`);
    console.error(`❌ [PostResponseProcessor] CRASHED`);
    console.error(`   Response ID: ${responseId}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error(`${'─'.repeat(60)}\n`);

    Logger.error("Post-response processor crashed", {
      error: error.message,
      stack: error.stack
    });
  }
};
