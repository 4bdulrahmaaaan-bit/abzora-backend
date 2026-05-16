const assert = require('node:assert/strict');

const PaymentOutboxEvent = require('../models/PaymentOutboxEvent');
const Transaction = require('../models/Transaction');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const AdminNotification = require('../models/AdminNotification');
const FinanceAuditLog = require('../models/FinanceAuditLog');
const { createPaymentOutboxWorker } = require('../services/paymentOutboxWorker');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInMemoryStore() {
  const events = [];
  const transactions = [];
  const analytics = [];
  const notifications = [];
  const audits = [];
  let idSeq = 1;

  function matches(doc, query) {
    if (!query) return true;
    return Object.entries(query).every(([key, value]) => {
      if (key === '$or') {
        return value.some((candidate) => matches(doc, candidate));
      }
      if (typeof value === 'object' && value !== null) {
        if ('$in' in value) return value.$in.includes(doc[key]);
        if ('$lt' in value) return Number(doc[key] || 0) < Number(value.$lt);
        if ('$lte' in value) return Number(doc[key] || 0) <= Number(value.$lte);
        if ('$ne' in value) return doc[key] !== value.$ne;
        if ('$exists' in value) return value.$exists ? doc[key] != null : doc[key] == null;
      }
      return doc[key] === value;
    });
  }

  return {
    events,
    transactions,
    analytics,
    notifications,
    audits,
    async seedEvent(event) {
      const seeded = {
        _id: `evt-${idSeq++}`,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        deadLetter: false,
        completedTargets: [],
        targetErrors: {},
        nextAttemptAt: new Date(Date.now() - 1).toISOString(),
        ...clone(event),
      };
      events.push(seeded);
      return seeded;
    },
    bind() {
      PaymentOutboxEvent.findOneAndUpdate = async (query, update) => {
        const candidate = events.find((item) => matches(item, query));
        if (!candidate) return null;
        if (update.$set) Object.assign(candidate, update.$set);
        if (update.$inc) {
          Object.entries(update.$inc).forEach(([k, v]) => {
            candidate[k] = Number(candidate[k] || 0) + Number(v);
          });
        }
        return clone(candidate);
      };
      PaymentOutboxEvent.updateOne = async (query, update) => {
        const candidate = events.find((item) => matches(item, query));
        if (!candidate) return { modifiedCount: 0 };
        if (update.$set) Object.assign(candidate, clone(update.$set));
        return { modifiedCount: 1 };
      };
      PaymentOutboxEvent.updateMany = async (query, update) => {
        let count = 0;
        events.forEach((item) => {
          if (!matches(item, query)) return;
          if (update.$set) Object.assign(item, clone(update.$set));
          count += 1;
        });
        return { modifiedCount: count };
      };
      PaymentOutboxEvent.deleteMany = async (query) => {
        const before = events.length;
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (matches(events[i], query)) {
            events.splice(i, 1);
          }
        }
        return { deletedCount: before - events.length };
      };

      Transaction.findOne = async (query) => transactions.find((item) => matches(item, query)) || null;
      Transaction.create = async (doc) => {
        transactions.push(clone(doc));
        return doc;
      };

      AnalyticsEvent.findOne = async (query) => analytics.find((item) => matches(item, query)) || null;
      AnalyticsEvent.create = async (doc) => {
        analytics.push(clone(doc));
        return doc;
      };

      AdminNotification.findOne = async (query) => notifications.find((item) => matches(item, query)) || null;
      AdminNotification.create = async (doc) => {
        notifications.push(clone(doc));
        return doc;
      };

      FinanceAuditLog.findOne = async (query) => audits.find((item) => matches(item, query)) || null;
      FinanceAuditLog.create = async (doc) => {
        audits.push(clone(doc));
        return doc;
      };
    },
  };
}

async function testDuplicateWorkerInstances() {
  const store = createInMemoryStore();
  await store.seedEvent({ eventId: 'evt-1', eventType: 'payment_captured_verify', orderId: 'o1' });
  store.bind();

  const workerA = createPaymentOutboxWorker({ workerId: 'worker-a', batchSize: 1, pollIntervalMs: 1000 });
  const workerB = createPaymentOutboxWorker({ workerId: 'worker-b', batchSize: 1, pollIntervalMs: 1000 });

  await Promise.all([workerA.processOnce(), workerB.processOnce()]);

  const processed = store.events.filter((item) => item.status === 'processed').length;
  assert.equal(processed, 1, 'only one worker should process the same event');
}

async function testRetryExhaustionToDeadLetter() {
  const store = createInMemoryStore();
  await store.seedEvent({ eventId: 'evt-2', eventType: 'payment_captured_verify', orderId: 'o2', maxAttempts: 1 });
  store.bind();
  FinanceAuditLog.create = async () => {
    throw new Error('forced_audit_failure');
  };

  const worker = createPaymentOutboxWorker({ workerId: 'worker-dead', batchSize: 1, pollIntervalMs: 1000, maxAttemptsDefault: 1 });
  await worker.processOnce();

  const failed = store.events.find((item) => item.eventId === 'evt-2');
  assert.equal(failed.deadLetter, true, 'event should be dead-lettered after retry exhaustion');
}

async function testReplayAfterDbReconnect() {
  const store = createInMemoryStore();
  await store.seedEvent({ eventId: 'evt-3', eventType: 'payment_captured_webhook', orderId: 'o3' });
  store.bind();
  let failClaim = true;
  const originalClaim = PaymentOutboxEvent.findOneAndUpdate;
  PaymentOutboxEvent.findOneAndUpdate = async (...args) => {
    if (failClaim) {
      failClaim = false;
      throw new Error('db_disconnected');
    }
    return originalClaim(...args);
  };

  const worker = createPaymentOutboxWorker({ workerId: 'worker-reconnect', batchSize: 1, pollIntervalMs: 1000 });
  await assert.doesNotReject(async () => {
    try {
      await worker.processOnce();
    } catch (_) {
      // expected first failure
    }
    await worker.processOnce();
  });

  const processed = store.events.find((item) => item.eventId === 'evt-3');
  assert.equal(processed.status, 'processed', 'event should process after reconnect');
}

async function testPartialDownstreamFailureRecovery() {
  const store = createInMemoryStore();
  await store.seedEvent({ eventId: 'evt-4', eventType: 'payment_captured_verify', orderId: 'o4' });
  store.bind();
  let failOnce = true;
  const originalAnalyticsCreate = AnalyticsEvent.create;
  AnalyticsEvent.create = async (doc) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('analytics_down');
    }
    return originalAnalyticsCreate(doc);
  };

  const worker = createPaymentOutboxWorker({ workerId: 'worker-partial', batchSize: 1, pollIntervalMs: 1000 });
  await worker.processOnce();
  await worker.processOnce();

  const event = store.events.find((item) => item.eventId === 'evt-4');
  assert.equal(event.status, 'processed', 'event should recover after partial downstream failure');
  assert(event.completedTargets.includes('audit'), 'completed targets should be retained across retries');
}

async function testCrashSafeRecoveryOnStop() {
  const store = createInMemoryStore();
  await store.seedEvent({
    eventId: 'evt-5',
    eventType: 'payment_captured_verify',
    orderId: 'o5',
    status: 'processing',
    lockedBy: 'worker-crash',
    lockExpiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  store.bind();
  const worker = createPaymentOutboxWorker({ workerId: 'worker-crash', batchSize: 1, pollIntervalMs: 1000 });
  await worker.stop();
  const event = store.events.find((item) => item.eventId === 'evt-5');
  assert.equal(event.status, 'failed', 'in-flight processing should be marked failed on stop');
}

async function run() {
  await testDuplicateWorkerInstances();
  await testRetryExhaustionToDeadLetter();
  await testReplayAfterDbReconnect();
  await testPartialDownstreamFailureRecovery();
  await testCrashSafeRecoveryOnStop();
  // eslint-disable-next-line no-console
  console.log('payment-outbox-worker tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('payment-outbox-worker tests failed:', error);
  process.exitCode = 1;
});
