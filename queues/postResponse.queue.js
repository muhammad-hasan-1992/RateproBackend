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

const POST_RESPONSE_QUEUE = "post-response-processing";

const postResponseQueue = createQueue(
  Queue,
  POST_RESPONSE_QUEUE,
  {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false
    }
  }
);

module.exports = { postResponseQueue, POST_RESPONSE_QUEUE };
