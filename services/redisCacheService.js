const DEFAULT_TTL_SECONDS = 90;

let redisClient = null;
let redisAvailable = false;
const localStore = new Map();
const keyRegistry = new Set();

function cleanupExpiredLocalKeys() {
  const now = Date.now();
  for (const [key, entry] of localStore.entries()) {
    if (entry.expiresAt <= now) {
      localStore.delete(key);
      keyRegistry.delete(key);
    }
  }
}

async function ensureRedisClient() {
  if (redisClient || process.env.REDIS_DISABLED === 'true') {
    return redisClient;
  }
  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) {
    return null;
  }
  try {
    // Lazy require keeps local/dev environments working even without redis package.
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', () => {
      redisAvailable = false;
    });
    await redisClient.connect();
    redisAvailable = true;
    return redisClient;
  } catch (error) {
    redisClient = null;
    redisAvailable = false;
    return null;
  }
}

async function getJson(key) {
  const client = await ensureRedisClient();
  if (client && redisAvailable) {
    const raw = await client.get(key);
    if (!raw) return null;
    keyRegistry.add(key);
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  cleanupExpiredLocalKeys();
  const local = localStore.get(key);
  if (!local) return null;
  return local.value;
}

async function setJson(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const client = await ensureRedisClient();
  if (client && redisAvailable) {
    await client.set(key, JSON.stringify(value), { EX: Math.max(1, ttlSeconds) });
    keyRegistry.add(key);
    return;
  }
  localStore.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
  });
  keyRegistry.add(key);
}

function matchesPattern(key, pattern) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return key === pattern;
  const safePattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${safePattern}$`).test(key);
}

async function delPattern(pattern) {
  const keys = Array.from(keyRegistry).filter((key) => matchesPattern(key, pattern));
  if (keys.length === 0) return 0;
  const client = await ensureRedisClient();
  if (client && redisAvailable) {
    await Promise.all(keys.map((key) => client.del(key)));
  }
  for (const key of keys) {
    localStore.delete(key);
    keyRegistry.delete(key);
  }
  return keys.length;
}

module.exports = {
  getJson,
  setJson,
  delPattern,
};

