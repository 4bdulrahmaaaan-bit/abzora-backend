let lockClient = null;
let redisReady = false;
const inMemoryLocks = new Map();
const {
  allowMemoryFallback,
  getRedisConfigSummary,
  getRedisUrl,
  isRedisDisabled,
  isRedisRequired,
} = require('./redisRuntimeConfig');
const { ensureRedisClient } = require('./redisClientManager');

function failClosedOpsLockOnRedisDown() {
  // Security hardening: production can block lock acquisition if Redis is unavailable
  // to avoid split-brain concurrent processing across instances.
  if (process.env.NODE_ENV === 'production') {
    return String(process.env.OPS_LOCK_FAIL_CLOSED || 'true').trim().toLowerCase() !== 'false';
  }
  return String(process.env.OPS_LOCK_FAIL_CLOSED || 'false').trim().toLowerCase() === 'true';
}

async function ensureLockRedis() {
  if (lockClient || isRedisDisabled()) {
    return lockClient;
  }
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  try {
    lockClient = await ensureRedisClient();
    if (!lockClient) {
      redisReady = false;
      return null;
    }
    lockClient.on('error', () => {
      redisReady = false;
    });
    lockClient.on('ready', () => {
      redisReady = true;
    });
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

  if (isRedisRequired() || (process.env.NODE_ENV === 'production' && failClosedOpsLockOnRedisDown())) {
    return false;
  }

  if (!allowMemoryFallback()) {
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

  if (!allowMemoryFallback()) {
    return;
  }
  const current = inMemoryLocks.get(key);
  if (current && current.owner === normalizedOwner) {
    inMemoryLocks.delete(key);
  }
}

function getOpsLockRuntimeStatus() {
  const config = getRedisConfigSummary();
  return {
    configured: config.configured && !config.disabled,
    required: config.required,
    redisAvailable: Boolean(lockClient?.isOpen) && redisReady,
    backend: (Boolean(lockClient?.isOpen) && redisReady) ? 'redis' : 'unavailable',
  };
}

async function closeOpsLockClient() {
  if (!lockClient) {
    return;
  }
  lockClient = null;
  redisReady = false;
}

module.exports = {
  acquireEntityLock,
  async initializeOpsLockRedis() {
    await ensureLockRedis();
  },
  closeOpsLockClient,
  getOpsLockRuntimeStatus,
  releaseEntityLock,
};
