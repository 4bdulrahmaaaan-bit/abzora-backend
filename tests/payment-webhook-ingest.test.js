const assert = require('node:assert/strict');

const PaymentWebhookIngestEvent = require('../models/PaymentWebhookIngestEvent');
const {
  createPaymentWebhookIngestWorker,
  persistWebhookIngestEvent,
} = require('../services/paymentWebhookIngestService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStore() {
  const rows = [];
  let seq = 1;

  function matches(doc, query) {
    if (!query) return true;
    return Object.entries(query).every(([key, value]) => {
      if (key === '$and') return value.every((x) => matches(doc, x));
      if (key === '$or') return value.some((x) => matches(doc, x));
      if (typeof value === 'object' && value !== null) {
        if ('$in' in value) return value.$in.includes(doc[key]);
        if ('$lt' in value) return Number(doc[key] || 0) < Number(value.$lt);
        if ('$lte' in value) return Number(new Date(doc[key] || 0).getTime()) <= Number(new Date(value.$lte).getTime());
        if ('$ne' in value) return doc[key] !== value.$ne;
        if ('$exists' in value) return value.$exists ? doc[key] != null : doc[key] == null;
      }
      return doc[key] === value;
    });
  }

  PaymentWebhookIngestEvent.create = async (doc) => {
    const item = clone(doc);
    if (rows.some((x) => x.eventId === item.eventId && x.source === item.source)) {
      const err = new Error('duplicate_key');
      err.code = 11000;
      throw err;
    }
    item._id = `ing-${seq++}`;
    item.status = item.status || 'pending';
    item.attempts = Number(item.attempts || 0);
    item.maxAttempts = Number(item.maxAttempts || 8);
    item.deadLetter = Boolean(item.deadLetter || false);
    item.nextAttemptAt = item.nextAttemptAt || new Date(Date.now() - 1).toISOString();
    item.createdAt = item.createdAt || new Date().toISOString();
    item.updatedAt = item.updatedAt || new Date().toISOString();
    rows.push(item);
    return item;
  };

  PaymentWebhookIngestEvent.findOneAndUpdate = async (query, update) => {
    const found = rows.find((row) => matches(row, query));
    if (!found) return null;
    if (update.$set) Object.assign(found, clone(update.$set));
    if (update.$inc) {
      Object.entries(update.$inc).forEach(([k, v]) => {
        found[k] = Number(found[k] || 0) + Number(v);
      });
    }
    found.updatedAt = new Date().toISOString();
    return clone(found);
  };

  PaymentWebhookIngestEvent.updateOne = async (query, update) => {
    const found = rows.find((row) => matches(row, query));
    if (!found) return { modifiedCount: 0 };
    if (update.$set) Object.assign(found, clone(update.$set));
    found.updatedAt = new Date().toISOString();
    return { modifiedCount: 1 };
  };

  PaymentWebhookIngestEvent.updateMany = async (query, update) => {
    let count = 0;
    rows.forEach((row) => {
      if (!matches(row, query)) return;
      if (update.$set) Object.assign(row, clone(update.$set));
      count += 1;
    });
    return { modifiedCount: count };
  };

  PaymentWebhookIngestEvent.deleteMany = async (query) => {
    const before = rows.length;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (matches(rows[i], query)) rows.splice(i, 1);
    }
    return { deletedCount: before - rows.length };
  };

  PaymentWebhookIngestEvent.findOne = (query) => ({
    select: () => ({
      lean: async () => {
        const found = rows.find((row) => matches(row, query));
        return found ? clone(found) : null;
      },
    }),
  });

  return { rows };
}

async function testWebhookBurstProcessing() {
  const store = createStore();
  for (let i = 0; i < 30; i += 1) {
    await PaymentWebhookIngestEvent.create({
      ingestId: `i-${i}`,
      source: 'razorpay-payment',
      event: 'payment.captured',
      eventId: `evt-${i}`,
      payload: { event: 'payment.captured', payment: { id: `p-${i}`, order_id: `o-${i}` } },
      payloadHash: `h-${i}`,
    });
  }
  const seen = new Set();
  const worker = createPaymentWebhookIngestWorker({
    workerId: 'burst-worker',
    batchSize: 20,
    concurrency: 8,
    processor: async (eventDoc) => {
      seen.add(eventDoc.eventId);
    },
  });
  await worker.processBatch();
  await worker.processBatch();
  assert.equal(seen.size, 30, 'burst events should all process asynchronously');
}

async function testDuplicateDeliveryProtection() {
  createStore();
  await persistWebhookIngestEvent({
    source: 'razorpay-payment',
    event: 'payment.captured',
    eventId: 'dup-1',
    rawBody: Buffer.from('x'),
    payload: { event: 'payment.captured', payment: { id: 'p1', order_id: 'o1' } },
  });
  const dup = await persistWebhookIngestEvent({
    source: 'razorpay-payment',
    event: 'payment.captured',
    eventId: 'dup-1',
    rawBody: Buffer.from('x'),
    payload: { event: 'payment.captured', payment: { id: 'p1', order_id: 'o1' } },
  });
  assert.equal(dup.duplicate, true, 'duplicate deliveries should be reported idempotently');
}

async function testDelayedWorkerRecoveryAfterOutage() {
  const store = createStore();
  await PaymentWebhookIngestEvent.create({
    ingestId: 'recover-1',
    source: 'razorpay-payment',
    event: 'payment.failed',
    eventId: 'recover-evt',
    payload: { event: 'payment.failed', payment: { id: 'p2', order_id: 'o2' } },
    payloadHash: 'h2',
  });
  let failOnce = true;
  const worker = createPaymentWebhookIngestWorker({
    workerId: 'recover-worker',
    batchSize: 2,
    processor: async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('db_downstream_unavailable');
      }
    },
  });
  await worker.processBatch();
  const rowAfterFailure = store.rows.find((x) => x.eventId === 'recover-evt');
  rowAfterFailure.nextAttemptAt = new Date(Date.now() - 1).toISOString();
  await worker.processBatch();
  const row = store.rows.find((x) => x.eventId === 'recover-evt');
  assert.equal(row.status, 'processed', 'event should recover after delayed worker restart path');
}

async function testReplayAfterCrash() {
  const store = createStore();
  await PaymentWebhookIngestEvent.create({
    ingestId: 'crash-1',
    source: 'razorpay-payment',
    event: 'refund.processed',
    eventId: 'crash-evt',
    payload: { event: 'refund.processed', refund: { id: 'r1', payment_id: 'p1' } },
    payloadHash: 'h3',
    status: 'processing',
    lockedBy: 'crash-worker',
    lockExpiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const worker = createPaymentWebhookIngestWorker({
    workerId: 'crash-worker',
    batchSize: 1,
    processor: async () => {},
  });
  await worker.stop();
  const row = store.rows.find((x) => x.eventId === 'crash-evt');
  assert.equal(row.status, 'failed', 'crash stop should make in-flight items retriable');
}

async function testDbOutageDuringIngestPersist() {
  createStore();
  const originalCreate = PaymentWebhookIngestEvent.create;
  PaymentWebhookIngestEvent.create = async () => {
    const err = new Error('db_outage');
    err.name = 'MongoNetworkError';
    throw err;
  };
  try {
    await assert.rejects(
      persistWebhookIngestEvent({
        source: 'razorpay-payment',
        event: 'payment.captured',
        eventId: 'db-outage-1',
        rawBody: Buffer.from('x'),
        payload: { event: 'payment.captured', payment: { id: 'p9', order_id: 'o9' } },
      }),
      /db_outage/,
    );
  } finally {
    PaymentWebhookIngestEvent.create = originalCreate;
  }
}

async function run() {
  await testWebhookBurstProcessing();
  await testDuplicateDeliveryProtection();
  await testDbOutageDuringIngestPersist();
  await testDelayedWorkerRecoveryAfterOutage();
  await testReplayAfterCrash();
  // eslint-disable-next-line no-console
  console.log('payment-webhook-ingest tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('payment-webhook-ingest tests failed:', error);
  process.exitCode = 1;
});
