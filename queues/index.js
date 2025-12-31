// queues/index.js
const redis = require("../config/redis");

const isQueueEnabled = process.env.ENABLE_QUEUES === "true";

const createQueue = (QueueClass, name, options) => {
  if (!isQueueEnabled || !redis) {
    return {
      add: async () => {
        console.log(`⚠️ Queue disabled, skipping job → ${name}`);
      }
    };
  }

  return new QueueClass(name, {
    connection: redis,
    ...options
  });
};

module.exports = { createQueue };
