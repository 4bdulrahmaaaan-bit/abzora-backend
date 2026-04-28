const { ALERT_SEVERITY } = require('./opsConstants');

const QUEUE_KEYS = {
  [ALERT_SEVERITY.CRITICAL]: 'ops:queue:critical',
  [ALERT_SEVERITY.HIGH]: 'ops:queue:high',
  [ALERT_SEVERITY.MEDIUM]: 'ops:queue:medium',
  [ALERT_SEVERITY.LOW]: 'ops:queue:low',
};

const localQueue = {
  [ALERT_SEVERITY.CRITICAL]: [],
  [ALERT_SEVERITY.HIGH]: [],
  [ALERT_SEVERITY.MEDIUM]: [],
  [ALERT_SEVERITY.LOW]: [],
};

let client = null;
let redisAvailable = false;

async function ensureRedis() {
  if (client || process.env.REDIS_DISABLED === 'true') {
    return client;
  }
  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) return null;
  try {
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    client = createClient({ url: redisUrl });
    client.on('error', () => {
      redisAvailable = false;
    });
    await client.connect();
    redisAvailable = true;
    return client;
  } catch (_) {
    client = null;
    redisAvailable = false;
    return null;
  }
}

async function enqueueAlert({ alertId, severity }) {
  const queueSeverity = QUEUE_KEYS[severity] ? severity : ALERT_SEVERITY.LOW;
  const redis = await ensureRedis();
  if (redis && redisAvailable) {
    await redis.rPush(QUEUE_KEYS[queueSeverity], alertId);
    return;
  }
  localQueue[queueSeverity].push(alertId);
}

async function dequeueAlert() {
  const ordered = [
    ALERT_SEVERITY.CRITICAL,
    ALERT_SEVERITY.HIGH,
    ALERT_SEVERITY.MEDIUM,
    ALERT_SEVERITY.LOW,
  ];
  const redis = await ensureRedis();
  if (redis && redisAvailable) {
    for (const severity of ordered) {
      const value = await redis.lPop(QUEUE_KEYS[severity]);
      if (value) {
        return value;
      }
    }
    return '';
  }

  for (const severity of ordered) {
    const item = localQueue[severity].shift();
    if (item) return item;
  }
  return '';
}

async function getQueueHealth() {
  const ordered = [
    ALERT_SEVERITY.CRITICAL,
    ALERT_SEVERITY.HIGH,
    ALERT_SEVERITY.MEDIUM,
    ALERT_SEVERITY.LOW,
  ];
  const redis = await ensureRedis();
  const bySeverity = {};
  let totalDepth = 0;

  if (redis && redisAvailable) {
    for (const severity of ordered) {
      const depth = Number(await redis.lLen(QUEUE_KEYS[severity])) || 0;
      bySeverity[severity] = depth;
      totalDepth += depth;
    }
    return { backend: 'redis', totalDepth, bySeverity };
  }

  for (const severity of ordered) {
    const depth = localQueue[severity].length;
    bySeverity[severity] = depth;
    totalDepth += depth;
  }
  return { backend: 'memory', totalDepth, bySeverity };
}

module.exports = {
  enqueueAlert,
  dequeueAlert,
  getQueueHealth,
};
