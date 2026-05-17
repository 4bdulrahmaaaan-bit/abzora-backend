const mongoose = require('mongoose');
const metrics = require('../services/telemetryMetrics');

let isConnected = false;
let lifecycleEventsBound = false;
let poolEventsBound = false;
let reconnectCount = 0;
let lastConnectAt = 0;
let lastDisconnectAt = 0;
let lastErrorAt = 0;
let lastErrorMessage = '';
let startupAttempts = 0;
let startupLastAttemptAt = 0;

const poolStats = {
  maxPoolSize: 0,
  minPoolSize: 0,
  checkedOut: 0,
  checkOutStarted: 0,
  checkOutFailed: 0,
  checkOutTimedOut: 0,
  checkedIn: 0,
  waitQueueEntered: 0,
  waitQueueExited: 0,
  recentlyTimedOutAt: 0,
};

function nowMs() {
  return Date.now();
}

function numberEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, raw));
}

function boolEnv(name, fallback) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true';
}

function buildMongoOptions() {
  // Production-safe defaults tuned for multi-pod + workers + webhook bursts.
  return {
    autoIndex: process.env.NODE_ENV !== 'production',
    maxPoolSize: numberEnv('MONGO_MAX_POOL_SIZE', 120, { min: 20, max: 2000 }),
    minPoolSize: numberEnv('MONGO_MIN_POOL_SIZE', 10, { min: 0, max: 500 }),
    maxIdleTimeMS: numberEnv('MONGO_MAX_IDLE_TIME_MS', 60000, { min: 10000, max: 600000 }),
    serverSelectionTimeoutMS: numberEnv('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000, { min: 1000, max: 120000 }),
    socketTimeoutMS: numberEnv('MONGO_SOCKET_TIMEOUT_MS', 45000, { min: 5000, max: 300000 }),
    heartbeatFrequencyMS: numberEnv('MONGO_HEARTBEAT_FREQUENCY_MS', 10000, { min: 1000, max: 60000 }),
    retryWrites: boolEnv('MONGO_RETRY_WRITES', true),
    retryReads: boolEnv('MONGO_RETRY_READS', true),
    // Security hardening: fail quickly under sustained pool pressure so readiness can shed load.
    waitQueueTimeoutMS: numberEnv('MONGO_WAIT_QUEUE_TIMEOUT_MS', 2000, { min: 100, max: 60000 }),
  };
}

function logDb(level, event, details = {}) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...details,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

function bindLifecycleEvents() {
  if (lifecycleEventsBound) {
    return;
  }
  lifecycleEventsBound = true;
  mongoose.connection.on('connected', () => {
    isConnected = true;
    lastConnectAt = nowMs();
    logDb('info', 'mongo_connected', {
      reconnectCount,
      readyState: mongoose.connection.readyState,
    });
  });
  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    lastDisconnectAt = nowMs();
    logDb('warn', 'mongo_disconnected', {
      reconnectCount,
      readyState: mongoose.connection.readyState,
    });
  });
  mongoose.connection.on('reconnected', () => {
    reconnectCount += 1;
    isConnected = true;
    lastConnectAt = nowMs();
    logDb('info', 'mongo_reconnected', {
      reconnectCount,
      readyState: mongoose.connection.readyState,
    });
  });
  mongoose.connection.on('error', (error) => {
    lastErrorAt = nowMs();
    lastErrorMessage = String(error?.message || error || 'unknown_mongo_error');
    logDb('error', 'mongo_error', {
      message: lastErrorMessage,
      reconnectCount,
      readyState: mongoose.connection.readyState,
    });
  });
}

function bindPoolEvents() {
  if (poolEventsBound) {
    return;
  }
  const client = mongoose.connection.getClient?.();
  if (!client?.on) {
    return;
  }
  poolEventsBound = true;

  client.on('connectionPoolCreated', (event) => {
    poolStats.maxPoolSize = Number(event?.options?.maxPoolSize || poolStats.maxPoolSize || 0);
    poolStats.minPoolSize = Number(event?.options?.minPoolSize || poolStats.minPoolSize || 0);
    logDb('info', 'mongo_pool_created', {
      maxPoolSize: poolStats.maxPoolSize,
      minPoolSize: poolStats.minPoolSize,
    });
  });

  client.on('connectionCheckedOut', () => {
    poolStats.checkedOut += 1;
    poolStats.waitQueueExited += 1;
    if (poolStats.waitQueueExited > poolStats.waitQueueEntered) {
      poolStats.waitQueueExited = poolStats.waitQueueEntered;
    }
  });
  client.on('connectionCheckedIn', () => {
    poolStats.checkedIn += 1;
    poolStats.checkedOut = Math.max(0, poolStats.checkedOut - 1);
  });
  client.on('connectionCheckOutStarted', () => {
    poolStats.checkOutStarted += 1;
    poolStats.waitQueueEntered += 1;
  });
  client.on('connectionCheckOutFailed', (event) => {
    poolStats.checkOutFailed += 1;
    poolStats.waitQueueExited += 1;
    if (String(event?.reason || '').toLowerCase().includes('timeout')) {
      poolStats.checkOutTimedOut += 1;
      poolStats.recentlyTimedOutAt = nowMs();
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt) {
  const base = numberEnv('MONGO_CONNECT_RETRY_BASE_MS', 800, { min: 100, max: 10000 });
  const cap = numberEnv('MONGO_CONNECT_RETRY_MAX_MS', 15000, { min: 1000, max: 120000 });
  const exp = Math.min(cap, base * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp * 0.25)));
  return exp + jitter;
}

function validateMongoUri(mongoUri) {
  if (!mongoUri || mongoUri.includes('username:password') || mongoUri.includes('cluster.mongodb.net/abzora')) {
    throw new Error('MONGO_URI is missing or still using the placeholder Atlas connection string.');
  }
}

async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const mongoUri = process.env.MONGO_URI;
  validateMongoUri(mongoUri);
  bindLifecycleEvents();

  const maxAttempts = numberEnv('MONGO_CONNECT_MAX_ATTEMPTS', 8, { min: 1, max: 100 });
  const options = buildMongoOptions();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = nowMs();
    startupAttempts += 1;
    startupLastAttemptAt = nowMs();
    try {
      await mongoose.connect(mongoUri, options);
      metrics.observe('mongo_connect_latency_ms', nowMs() - started, { attempt });
      metrics.inc('mongo_connect_success_total', 1);
      isConnected = true;
      bindPoolEvents();
      return mongoose.connection;
    } catch (error) {
      metrics.observe('mongo_connect_latency_ms', nowMs() - started, { attempt });
      metrics.inc('mongo_connect_failure_total', 1);
      lastErrorAt = nowMs();
      lastErrorMessage = String(error?.message || error || 'mongo_connect_failed');
      logDb('error', 'mongo_connect_attempt_failed', {
        attempt,
        maxAttempts,
        message: lastErrorMessage,
      });
      if (attempt >= maxAttempts) {
        throw error;
      }
      // Security hardening: exponential backoff + jitter prevents reconnect storms.
      await sleep(backoffMs(attempt));
    }
  }
  return mongoose.connection;
}

function getMongoHealth() {
  const options = buildMongoOptions();
  const maxPoolSize = Number(poolStats.maxPoolSize || options.maxPoolSize || 1);
  const saturationRatio = maxPoolSize > 0 ? (poolStats.checkedOut / maxPoolSize) : 0;
  const saturationThreshold = Number(process.env.MONGO_POOL_SATURATION_THRESHOLD || 0.95);
  const pressureThreshold = Number(process.env.MONGO_POOL_PRESSURE_THRESHOLD || 0.8);
  const recentTimeoutWindowMs = numberEnv('MONGO_POOL_TIMEOUT_WINDOW_MS', 30000, { min: 1000, max: 300000 });
  const hadRecentCheckoutTimeout = poolStats.recentlyTimedOutAt > 0
    && (nowMs() - poolStats.recentlyTimedOutAt) <= recentTimeoutWindowMs;
  const waitQueueDepthApprox = Math.max(0, Number(poolStats.waitQueueEntered || 0) - Number(poolStats.waitQueueExited || 0));
  const underLivePressure = saturationRatio >= pressureThreshold || waitQueueDepthApprox > 5;
  // Do not mark pool exhausted based only on stale timeout telemetry after pressure recovers.
  const poolExhausted = saturationRatio >= saturationThreshold || (hadRecentCheckoutTimeout && underLivePressure);

  return {
    readyState: mongoose.connection.readyState,
    connected: mongoose.connection.readyState === 1,
    reconnectCount,
    lastConnectAt,
    lastDisconnectAt,
    lastErrorAt,
    lastErrorMessage,
    startupAttempts,
    startupLastAttemptAt,
    options,
    pool: {
      ...poolStats,
      saturationRatio: Number(saturationRatio.toFixed(4)),
      saturationThreshold,
      pressureThreshold,
      waitQueueDepthApprox,
      underLivePressure,
      poolExhausted,
    },
  };
}

async function closeDBConnection() {
  if (mongoose.connection.readyState === 0) {
    return;
  }
  await mongoose.connection.close(false);
  isConnected = false;
}

module.exports = connectDB;
module.exports.buildMongoOptions = buildMongoOptions;
module.exports.closeDBConnection = closeDBConnection;
module.exports.getMongoHealth = getMongoHealth;
