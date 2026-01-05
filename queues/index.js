// queues/index.js
const redis = require("../config/redis");

const isQueueEnabled = process.env.ENABLE_QUEUES === "true";

console.log("🔧 [Queue Config] ENABLE_QUEUES:", process.env.ENABLE_QUEUES);
console.log("🔧 [Queue Config] isQueueEnabled:", isQueueEnabled);
console.log("🔧 [Queue Config] Redis available:", !!redis);

/**
 * Creates a queue with fallback to inline processing when queues are disabled.
 * @param {Class} QueueClass - BullMQ Queue class
 * @param {string} name - Queue name
 * @param {object} options - Queue options
 * @param {Function} inlineProcessor - Function to call when queues are disabled
 */
const createQueue = (QueueClass, name, options, inlineProcessor = null) => {
  if (!isQueueEnabled || !redis) {
    console.log(`📦 [Queue] Creating mock queue for "${name}" (queues disabled)`);
    return {
      add: async (jobName, data) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`⚠️ [Queue] DISABLED - Processing inline`);
        console.log(`   Queue: ${name}`);
        console.log(`   Job: ${jobName}`);
        console.log(`   Data keys: ${Object.keys(data || {}).join(', ')}`);
        console.log(`${'='.repeat(60)}`);
        
        if (inlineProcessor) {
          console.log(`🚀 [Queue] Starting inline processor...`);
          const startTime = Date.now();
          try {
            await inlineProcessor(data);
            console.log(`✅ [Queue] Inline processing completed in ${Date.now() - startTime}ms`);
          } catch (err) {
            console.error(`❌ [Queue] Inline processing FAILED:`, err.message);
            console.error(`   Stack:`, err.stack);
          }
        } else {
          console.warn(`⚠️ [Queue] No inline processor provided for ${name}/${jobName}`);
        }
        console.log(`${'='.repeat(60)}\n`);
      }
    };
  }

  console.log(`📦 [Queue] Creating BullMQ queue for "${name}" (queues enabled)`);
  return new QueueClass(name, {
    connection: redis,
    ...options
  });
};

module.exports = { createQueue, isQueueEnabled };
