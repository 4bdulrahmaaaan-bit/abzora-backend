let lockClient = null;
let redisReady = false;
const inMemoryLocks = new Map();

async function ensureLockRedis() {
  if (lockClient || process.env.REDIS_DISABLED === 'true') {
    return lockClient;
  }
  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) return null;
  try {
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    lockClient = createClient({ url: redisUrl });
    lockClient.on('error', () => {
      redisReady = false;
    });
    await lockClient.connect();
    redisReady = true;
    return lockClient;
  } catch (_) {
    lockClient = null;
    redisReady = false;
    return null;
  }
}

function lockKey(entityType, entityId) {
  return `ops:lock:${entityType}:${entityId}`;
}

async function acquireEntityLock({ entityType, entityId, owner, ttlMs = 20000 }) {
  const redis = await ensureLockRedis();
  const key = lockKey(entityType, entityId);
  const normalizedOwner = String(owner || 'system');

  if (redis && redisReady) {
    const response = await redis.set(key, normalizedOwner, {
      NX: true,
      PX: Math.max(1000, ttlMs),
    });
    return response === 'OK';
  }

  const now = Date.now();
  const current = inMemoryLocks.get(key);
  if (current && current.expiresAt > now) {
    return false;
  }
  inMemoryLocks.set(key, {
    owner: normalizedOwner,
    expiresAt: now + Math.max(1000, ttlMs),
  });
  return true;
}

async function releaseEntityLock({ entityType, entityId, owner }) {
  const redis = await ensureLockRedis();
  const key = lockKey(entityType, entityId);
  const normalizedOwner = String(owner || 'system');

  if (redis && redisReady) {
    const currentOwner = await redis.get(key);
    if (currentOwner && currentOwner === normalizedOwner) {
      await redis.del(key);
    }
    return;
  }

  const current = inMemoryLocks.get(key);
  if (current && current.owner === normalizedOwner) {
    inMemoryLocks.delete(key);
  }
}

module.exports = {
  acquireEntityLock,
  releaseEntityLock,
};
