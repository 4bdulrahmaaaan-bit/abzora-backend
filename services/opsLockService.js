let lockClient = null;
let redisReady = false;
const inMemoryLocks = new Map();

function failClosedOpsLockOnRedisDown() {
  // Security hardening: production can block lock acquisition if Redis is unavailable
  // to avoid split-brain concurrent processing across instances.
  if (process.env.NODE_ENV === 'production') {
    return String(process.env.OPS_LOCK_FAIL_CLOSED || 'true').trim().toLowerCase() !== 'false';
  }
  return String(process.env.OPS_LOCK_FAIL_CLOSED || 'false').trim().toLowerCase() === 'true';
}

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

  if (process.env.NODE_ENV === 'production' && failClosedOpsLockOnRedisDown()) {
    return false;
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

function getOpsLockRuntimeStatus() {
  return {
    configured: Boolean(process.env.REDIS_URL) && process.env.REDIS_DISABLED !== 'true',
    redisReady,
    backend: redisReady ? 'redis' : 'memory',
  };
}

async function closeOpsLockClient() {
  if (!lockClient) {
    return;
  }
  try {
    await lockClient.quit();
  } catch (_) {
    // Security hardening: shutdown path should continue even when redis close fails.
  } finally {
    lockClient = null;
    redisReady = false;
  }
}

module.exports = {
  acquireEntityLock,
  closeOpsLockClient,
  getOpsLockRuntimeStatus,
  releaseEntityLock,
};
