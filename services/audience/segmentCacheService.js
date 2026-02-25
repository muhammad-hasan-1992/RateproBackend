// services/audience/segmentCacheService.js
// simple in-memory cache (can replace with Redis)

const cache = new Map();
const TTL = 60 * 1000; // 1 minute

function makeKey(tenantId, segmentId) {
  return `${tenantId}:${segmentId}`;
}

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function set(key, value) {
  cache.set(key, {
    value,
    expiry: Date.now() + TTL,
  });
}

function invalidate(key) {
  cache.delete(key);
}

module.exports = {
  get,
  set,
  makeKey,
  invalidate,
};