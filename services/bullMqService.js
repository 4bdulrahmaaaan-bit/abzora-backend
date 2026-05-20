const { ensureRedisClient } = require('./redisClientManager');

const queues = {};
const workers = [];
const queueEvents = {};
const workerStats = {};
let bullMqLib = null;

function getBullMqLib() {
  if (bullMqLib) {
    return bullMqLib;
  }
  try {
    // Lazy-load so app can still boot while dependency install is pending.
    // eslint-disable-next-line global-require
    bullMqLib = require('bullmq');
    return bullMqLib;
  } catch (error) {
    throw new Error('BullMQ dependency missing. Install bullmq in backend.');
  }
}

const queueNames = {
  invoiceGeneration: 'invoice-generation',
  pdfRendering: 'invoice-pdf-rendering',
  emailSending: 'invoice-email-sending',
  gstExports: 'invoice-gst-exports',
  cleanup: 'invoice-cleanup',
  deadLetter: 'invoice-dead-letter',
};

async function connectionOptions() {
  const client = await ensureRedisClient();
  if (!client) {
    throw new Error('Redis unavailable for BullMQ');
  }
  const url = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || '';
  if (url) {
    return { connection: { url } };
  }
  return { connection: { host: '127.0.0.1', port: 6379 } };
}

async function getQueue(name) {
  if (queues[name]) return queues[name];
  const { Queue, QueueEvents } = getBullMqLib();
  const opts = await connectionOptions();
  queues[name] = new Queue(name, opts);
  queueEvents[name] = new QueueEvents(name, opts);
  return queues[name];
}

async function addJob(name, jobName, data, opts = {}) {
  const queue = await getQueue(name);
  return queue.add(jobName, data, {
    attempts: opts.attempts || 5,
    backoff: opts.backoff || { type: 'exponential', delay: 2000 },
    removeOnComplete: opts.removeOnComplete ?? 500,
    removeOnFail: opts.removeOnFail ?? 1000,
    ...opts,
  });
}

async function registerWorker(name, processor, opts = {}) {
  const { Worker } = getBullMqLib();
  const conn = await connectionOptions();
  workerStats[name] = workerStats[name] || {
    processed: 0,
    completed: 0,
    failed: 0,
    stalled: 0,
    retriesScheduled: 0,
    lastError: '',
    lastErrorAt: null,
    lastProcessedAt: null,
  };
  const worker = new Worker(name, processor, {
    connection: conn.connection,
    concurrency: opts.concurrency || 5,
    limiter: opts.limiter,
    settings: {
      stalledInterval: Number(process.env.BULLMQ_STALLED_INTERVAL_MS || 30000),
      maxStalledCount: Number(process.env.BULLMQ_MAX_STALLED_COUNT || 2),
    },
  });
  worker.on('active', () => {
    workerStats[name].processed += 1;
    workerStats[name].lastProcessedAt = new Date();
  });
  worker.on('completed', () => {
    workerStats[name].completed += 1;
  });
  worker.on('failed', (_, error) => {
    workerStats[name].failed += 1;
    workerStats[name].lastError = String(error?.message || error || '');
    workerStats[name].lastErrorAt = new Date();
  });
  worker.on('stalled', () => {
    workerStats[name].stalled += 1;
  });
  workers.push(worker);
  return worker;
}

async function closeBullMq() {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queueEvents).map((e) => e.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
}

function bullMqHealth() {
  return {
    queueNames,
    workers: workers.length,
    activeQueues: Object.keys(queues),
    workerStats,
  };
}

async function queueMetrics() {
  const metrics = {};
  const names = Object.values(queueNames);
  for (const name of names) {
    try {
      const queue = await getQueue(name);
      const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed', 'paused');
      metrics[name] = { ...counts };
    } catch (error) {
      metrics[name] = { error: String(error?.message || error) };
    }
  }
  return metrics;
}

async function pauseQueue(name) {
  const queue = await getQueue(name);
  await queue.pause();
  return true;
}

async function resumeQueue(name) {
  const queue = await getQueue(name);
  await queue.resume();
  return true;
}

async function replayDeadLetter({ limit = 50 } = {}) {
  const deadQueue = await getQueue(queueNames.deadLetter);
  const jobs = await deadQueue.getJobs(['waiting', 'delayed', 'failed'], 0, Math.max(0, Number(limit) - 1), true);
  let replayed = 0;
  for (const job of jobs) {
    const data = job.data || {};
    if (data.sourceQueue === queueNames.emailSending && data.emailLogId) {
      await addJob(queueNames.emailSending, 'invoice-email-replay', { emailLogId: data.emailLogId }, {
        attempts: 6,
        backoff: { type: 'exponential', delay: 2000 },
      });
      replayed += 1;
    }
    await job.remove();
  }
  return { replayed, scanned: jobs.length };
}

module.exports = {
  queueNames,
  addJob,
  registerWorker,
  closeBullMq,
  bullMqHealth,
  queueMetrics,
  workerStats,
  pauseQueue,
  resumeQueue,
  replayDeadLetter,
};
