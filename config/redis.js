// // config/redis.js
// const { Redis } = require("ioredis");

// const redis = new Redis({
//   host: process.env.REDIS_HOST || "127.0.0.1",
//   port: process.env.REDIS_PORT || 6379,
//   maxRetriesPerRequest: null
// });

// module.exports = redis;
// const Redis = require("ioredis");

// let redis = null;

// try {
//   redis = new Redis({
//     host: "127.0.0.1",
//     port: 6379,
//     lazyConnect: true,
//     maxRetriesPerRequest: 1,
//   });

//   redis.on("connect", () => {
//     console.log("✅ Redis connected");
//   });

//   redis.on("error", (err) => {
//     console.warn("⚠️ Redis error:", err.message);
//   });

// } catch (err) {
//   console.warn("⚠️ Redis disabled");
// }

// module.exports = redis;

const Redis = require("ioredis");

let redis = null;

// Agar Render par REDIS_URL mil jaye to wo use kare, 
// warna local host use kare (Docker wala)
const redisConnectionString = process.env.REDIS_URL || "redis://127.0.0.1:6379";

try {
  // ioredis connection string ko direct support karta hai
  redis = new Redis(redisConnectionString, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Render/Production ke liye ye settings behtar hain
    reconnectOnError: (err) => {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
  });

  redis.on("connect", () => {
    console.log("✅ Redis connected");
  });

  redis.on("error", (err) => {
    console.warn("⚠️ Redis error:", err.message);
  });

} catch (err) {
  console.warn("⚠️ Redis disabled", err);
}

module.exports = redis;