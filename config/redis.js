// // config/redis.js
// const { Redis } = require("ioredis");

// const redis = new Redis({
//   host: process.env.REDIS_HOST || "127.0.0.1",
//   port: process.env.REDIS_PORT || 6379,
//   maxRetriesPerRequest: null
// });

// module.exports = redis;
const Redis = require("ioredis");

let redis = null;

try {
  redis = new Redis({
    host: "127.0.0.1",
    port: 6379,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  redis.on("connect", () => {
    console.log("✅ Redis connected");
  });

  redis.on("error", (err) => {
    console.warn("⚠️ Redis error:", err.message);
  });

} catch (err) {
  console.warn("⚠️ Redis disabled");
}

module.exports = redis;