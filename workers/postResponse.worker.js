const { Worker } = require("bullmq");
const redis = require("../config/redis");
const { POST_RESPONSE_QUEUE } = require("../queues/postResponse.queue");
const { postResponseDLQ } = require("../queues/postResponse.dlq");
const { processPostSurveyResponse } = require("../services/postResponse/postResponseProcessor");
const Logger = require("../utils/auditLog");

// 🔒 DEV / QUEUE SAFETY CHECK
if (process.env.ENABLE_QUEUES !== "true") {
  console.log("⚠️ Worker disabled (ENABLE_QUEUES=false)");
  module.exports = null;
  return;
}

// ✅ Worker initialization (ONLY if queues enabled)
const worker = new Worker(
  POST_RESPONSE_QUEUE,
  async (job) => {
    await processPostSurveyResponse(job.data);
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

// ❌ Failure → DLQ
worker.on("failed", async (job, err) => {
  try {
    await postResponseDLQ.add("failed-response", {
      originalJobId: job.id,
      data: job.data,
      error: err.message,
      failedAt: new Date(),
    });

    Logger.error("Job moved to DLQ", {
      jobId: job.id,
      error: err.message,
    });
  } catch (dlqErr) {
    Logger.error("Failed to push job to DLQ", dlqErr);
  }
});

module.exports = worker;
