const assert = require('assert');
const path = require('path');

const telemetry = require(path.join(__dirname, '..', 'services', 'telemetryContext'));

async function testRequestIdUniqueness() {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) {
    ids.add(telemetry.requestId());
  }
  assert(ids.size === 500, 'requestId must be unique across 500 samples');
}

async function testQueueTraceContinuity() {
  process.env.REDIS_DISABLED = 'true';
  process.env.REDIS_REQUIRED = 'false';
  const queuePath = path.join(__dirname, '..', 'services', 'opsQueueService.js');
  delete require.cache[require.resolve(queuePath)];
  const queue = require(queuePath);

  await telemetry.runWithContext({
    requestId: 'req-queue-1',
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
  }, async () => {
    const accepted = await queue.enqueueAlert({
      alertId: 'alert-1',
      severity: 'HIGH',
      tenantKey: 'tenant-1',
      jobClass: 'order',
    });
    assert(accepted.accepted === true, 'queue enqueue should accept');
  });

  const popped = await queue.dequeueAlertDetailed();
  assert(popped, 'queue dequeue should return item');
  assert(popped.traceContext, 'queue payload must include trace context');
  assert(popped.traceContext.requestId === 'req-queue-1', 'requestId must propagate through queue');
  assert(popped.traceContext.traceId === 'a'.repeat(32), 'traceId must propagate through queue');
}

async function testWebhookTraceContinuity() {
  const modelPath = path.join(__dirname, '..', 'models', 'PaymentWebhookIngestEvent.js');
  const servicePath = path.join(__dirname, '..', 'services', 'paymentWebhookIngestService.js');

  let capturedCreate = null;
  delete require.cache[require.resolve(modelPath)];
  require.cache[require.resolve(modelPath)] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: {
      create: async (doc) => {
        capturedCreate = doc;
      },
    },
  };
  delete require.cache[require.resolve(servicePath)];
  const ingestService = require(servicePath);

  await telemetry.runWithContext({
    requestId: 'req-webhook-1',
    traceId: 'c'.repeat(32),
    spanId: 'd'.repeat(16),
  }, async () => {
    await ingestService.persistWebhookIngestEvent({
      source: 'razorpay-payment',
      event: 'payment.captured',
      eventId: 'evt-1',
      rawBody: Buffer.from('{}'),
      payload: { event: 'payment.captured' },
      metadata: { origin: 'test' },
    });
  });

  assert(capturedCreate, 'ingest event create should be called');
  const metadata = capturedCreate.metadata || {};
  assert(String(metadata.traceId) === 'c'.repeat(32), 'webhook ingest metadata traceId must propagate');
  assert(String(metadata.requestId) === 'req-webhook-1', 'webhook ingest metadata requestId must propagate');
}

async function run() {
  await testRequestIdUniqueness();
  await testQueueTraceContinuity();
  await testWebhookTraceContinuity();
  // eslint-disable-next-line no-console
  console.log('telemetry-trace-propagation tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('telemetry-trace-propagation tests failed:', error);
  process.exit(1);
});

