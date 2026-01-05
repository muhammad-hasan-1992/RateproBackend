// // queues/postResponse.queue.js
// const { Queue } = require("bullmq");
// const redis = require("../config/redis");

// const POST_RESPONSE_QUEUE = "post-response-processing";

// const postResponseQueue = new Queue(POST_RESPONSE_QUEUE, {
//   connection: redis,
//   defaultJobOptions: {
//     attempts: 3,              // retry
//     backoff: {
//       type: "exponential",
//       delay: 5000
//     },
//     removeOnComplete: true,
//     removeOnFail: false
//   }
// });

// module.exports = {
//   postResponseQueue,
//   POST_RESPONSE_QUEUE
// };
const { Queue } = require("bullmq");
const { createQueue } = require("./index");
const { processPostSurveyResponse } = require("../services/postResponse/postResponseProcessor");

const POST_RESPONSE_QUEUE = "post-response-processing";

// Pass the processor as fallback for when queues are disabled
const postResponseQueue = createQueue(
  Queue,
  POST_RESPONSE_QUEUE,
  {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: 100,
      removeOnFail: 50
    }
  },
  processPostSurveyResponse  // 👈 Inline fallback processor
);

module.exports = {
  postResponseQueue,
  POST_RESPONSE_QUEUE
};
