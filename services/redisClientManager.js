const { createClient } = require('redis');
const {
  getRedisConfigSummary,
  getRedisUrl,
  isRedisDisabled,
} = require('./redisRuntimeConfig');
const metrics = require('./telemetryMetrics');

let sharedClient = null;
let connectPromise = null;
let retryTimer = null;
let reconnecting = false;
let lastConnectAt = 0;
let lastErrorAt = 0;
let lastErrorMessage = '';

function numberEnv(name, fallback, min = 0) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, value);
}

function backoffMs(attempt) {
  const base = numberEnv('REDIS_CONNECT_RETRY_BASE_MS', 500, 50);
  const cap = numberEnv('REDIS_CONNECT_RETRY_MAX_MS', 10000, 250);
  const exp = Math.min(cap, base * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp * 0.2)));
  return exp + jitter;
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function markError(error) {
  lastErrorAt = Date.now();
  lastErrorMessage = String(error?.message || error || 'redis_connect_failed');
  reconnecting = false;
}

function buildClient() {
  const url = getRedisUrl();
  if (!url) return null;
  const socketConnectTimeout = numberEnv('REDIS_SOCKET_CONNECT_TIMEOUT_MS', 5000, 500);
  const keepAliveMs = numberEnv('REDIS_SOCKET_KEEPALIVE_MS', 5000, 500);

  const client = createClient({
    url,
    socket: {
      connectTimeout: socketConnectTimeout,
      keepAlive: keepAliveMs,
      reconnectStrategy: (retries) => {
        reconnecting = true;
        return Math.min(2000 + retries * 200, 10000);
      },
    },
  });
  client.on('ready', () => {
    reconnecting = false;
    lastConnectAt = Date.now();
  });
  client.on('error', (error) => {
    markError(error);
  });
  client.on('end', () => {
    reconnecting = false;
  });
  return client;
}

async function connectWithRetry(maxAttempts = numberEnv('REDIS_CONNECT_INIT_MAX_ATTEMPTS', 5, 1)) {
  if (isRedisDisabled()) return null;
  const config = getRedisConfigSummary();
  if (!config.configured) return null;

  if (sharedClient?.isOpen) {
    return sharedClient;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      if (!sharedClient) {
        sharedClient = buildClient();
      }
      if (!sharedClient) return null;
      await sharedClient.connect();
      lastConnectAt = Date.now();
      metrics.observe('redis_connect_latency_ms', Date.now() - started, { attempt });
      metrics.inc('redis_connect_success_total', 1);
      return sharedClient;
    } catch (error) {
      markError(error);
      metrics.observe('redis_connect_latency_ms', Date.now() - started, { attempt });
      metrics.inc('redis_connect_failure_total', 1);
      try {
        await sharedClient?.quit();
      } catch (_) {
        // ignore
      }
      sharedClient = null;
      if (attempt < maxAttempts) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
      }
    }
  }
  return null;
}

function scheduleReconnect() {
  clearRetryTimer();
  retryTimer = setTimeout(async () => {
    connectPromise = null;
    await ensureRedisClient();
    if (!(sharedClient?.isReady)) {
      scheduleReconnect();
    }
  }, backoffMs(2));
  retryTimer.unref?.();
}

async function ensureRedisClient() {
  if (isRedisDisabled()) return null;
  if (sharedClient?.isReady) return sharedClient;
  if (connectPromise) return connectPromise;

  connectPromise = connectWithRetry();
  const client = await connectPromise;
  connectPromise = null;
  if (!client) {
    scheduleReconnect();
  } else {
    clearRetryTimer();
  }
  return client;
}

function getRedisManagerStatus() {
  const config = getRedisConfigSummary();
  const isReady = Boolean(sharedClient?.isReady);
  const isOpen = Boolean(sharedClient?.isOpen);
  return {
    configured: config.configured && !config.disabled,
    required: config.required,
    connected: isReady,
    reconnecting: reconnecting || (isOpen && !isReady),
    open: isOpen,
    lastConnectAt,
    lastErrorAt,
    lastErrorMessage,
  };
}

async function warmupRedisClient() {
  return ensureRedisClient();
}

async function closeRedisClientManager() {
  clearRetryTimer();
  connectPromise = null;
  if (sharedClient) {
    try {
      await sharedClient.quit();
    } catch (_) {
      // ignore
    } finally {
      sharedClient = null;
    }
  }
}

module.exports = {
  closeRedisClientManager,
  ensureRedisClient,
  getRedisManagerStatus,
  warmupRedisClient,
};
