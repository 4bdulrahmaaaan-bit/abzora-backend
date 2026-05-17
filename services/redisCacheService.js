const DEFAULT_TTL_SECONDS = 90;
const {
  allowMemoryFallback,
  getRedisConfigSummary,
  getRedisUrl,
  isRedisDisabled,
  isRedisRequired,
} = require('./redisRuntimeConfig');
const { ensureRedisClient: ensureSharedRedisClient } = require('./redisClientManager');

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
  if (redisClient || isRedisDisabled()) {
    return redisClient;
  }
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }
  try {
    redisClient = await ensureSharedRedisClient();
    if (!redisClient) {
      redisAvailable = false;
      return null;
    }
    redisClient.on('error', () => {
      redisAvailable = false;
    });
    redisClient.on('ready', () => {
      redisAvailable = true;
    });
    redisAvailable = true;
    // stale local fallback state must be purged once redis is authoritative.
    localStore.clear();
    keyRegistry.clear();
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
  if (!allowMemoryFallback() && isRedisRequired()) {
    return null;
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
  if (!allowMemoryFallback() && isRedisRequired()) {
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
  if (!allowMemoryFallback() && isRedisRequired()) {
    return 0;
  }
  for (const key of keys) {
    localStore.delete(key);
    keyRegistry.delete(key);
  }
  return keys.length;
}

module.exports = {
  async initializeRedisCacheClient() {
    await ensureRedisClient();
  },
  async closeRedisCacheClient() {
    if (!redisClient) {
      return;
    }
    redisClient = null;
    redisAvailable = false;
  },
  getJson,
  getRuntimeStatus() {
    const config = getRedisConfigSummary();
    return {
      configured: config.configured && !config.disabled,
      required: config.required,
      redisAvailable: Boolean(redisClient?.isOpen) && redisAvailable,
      backend: (Boolean(redisClient?.isOpen) && redisAvailable) ? 'redis' : 'unavailable',
    };
  },
  setJson,
  delPattern,
};
