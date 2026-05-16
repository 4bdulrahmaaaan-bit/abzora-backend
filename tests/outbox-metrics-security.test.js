const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeReq(overrides = {}) {
  return {
    requestId: 'req-outbox-1',
    originalUrl: '/metrics/outbox',
    query: {},
    user: null,
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    text: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.text = payload;
      return this;
    },
  };
}

function loadControllerWithStubbedMetrics(metricsProvider) {
  const controllerPath = path.join(__dirname, '..', 'controllers', 'outboxOpsController.js');
  const metricsPath = path.join(__dirname, '..', 'services', 'outboxMetricsService.js');
  delete require.cache[require.resolve(controllerPath)];
  delete require.cache[require.resolve(metricsPath)];
  require.cache[require.resolve(metricsPath)] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: { computeOutboxMetrics: metricsProvider },
  };
  return require(controllerPath);
}

async function testUnauthorizedAccess() {
  const controller = loadControllerWithStubbedMetrics(async () => ({}));
  const res = makeRes();
  await controller.getOutboxMetrics(makeReq({ user: { uid: 'u1', role: 'vendor' } }), res, () => {});
  assert(res.statusCode === 403, 'non-admin should be denied for outbox metrics');
}

async function testStaleWorkerDetection() {
  const controller = loadControllerWithStubbedMetrics(async () => ({
    generatedAtIso: new Date().toISOString(),
    counts: { pending: 1, failed: 0, deadLetter: 0, processing: 0 },
    retries: { totalAttempts: 1, highRetryCount: 0, maxAttemptsSeen: 1 },
    throughput: { processedLast1m: 0, processedLast5m: 0, processedLast1h: 0 },
    oldestPendingAgeSeconds: 5,
    anomalies: { staleLeaseCount: 0, staleHeartbeatCount: 1, stuckProcessingCount: 0 },
    deadLetters: { last5m: 0 },
    worker: { running: false, heartbeatStale: true, workerId: '', lastTickAt: 0, lastTickError: '', lastTickErrorAt: 0, heartbeatAgeMs: 999999, metrics: {} },
    alerts: [{ code: 'worker_heartbeat_stale' }],
    thresholds: {},
  }));
  const res = makeRes();
  await controller.getOutboxWorkerHealth(makeReq({ user: { uid: 'a1', role: 'admin' }, originalUrl: '/health/outbox-worker' }), res, () => {});
  assert(res.statusCode === 200, 'admin health endpoint should succeed');
  assert(res.body.data.worker.heartbeatStale === true, 'stale worker should be reported');
}

async function testDeadLetterThresholdAlertsPresent() {
  const controller = loadControllerWithStubbedMetrics(async () => ({
    generatedAtIso: new Date().toISOString(),
    counts: { pending: 50, failed: 10, deadLetter: 30, processing: 2 },
    retries: { totalAttempts: 400, highRetryCount: 60, maxAttemptsSeen: 9 },
    throughput: { processedLast1m: 1, processedLast5m: 3, processedLast1h: 100 },
    oldestPendingAgeSeconds: 300,
    anomalies: { staleLeaseCount: 2, staleHeartbeatCount: 3, stuckProcessingCount: 6 },
    deadLetters: { last5m: 11 },
    worker: { running: true, heartbeatStale: false, workerId: 'w1', lastTickAt: Date.now(), lastTickError: '', lastTickErrorAt: 0, heartbeatAgeMs: 10, metrics: {} },
    alerts: [{ code: 'dead_letter_count_high' }, { code: 'dead_letter_spike_5m' }],
    thresholds: {},
  }));
  const res = makeRes();
  await controller.getOutboxMetrics(makeReq({ user: { uid: 'a2', role: 'super_admin' } }), res, () => {});
  const alertCodes = (res.body.data.alerts || []).map((item) => item.code);
  assert(alertCodes.includes('dead_letter_count_high'), 'dead-letter alert should be exposed');
  assert(alertCodes.includes('dead_letter_spike_5m'), 'dead-letter spike alert should be exposed');
}

async function testPrometheusFormat() {
  const controller = loadControllerWithStubbedMetrics(async () => ({
    generatedAtIso: new Date().toISOString(),
    counts: { pending: 2, failed: 1, deadLetter: 0, processing: 1 },
    retries: { totalAttempts: 2, highRetryCount: 0, maxAttemptsSeen: 1 },
    throughput: { processedLast1m: 1, processedLast5m: 2, processedLast1h: 10 },
    oldestPendingAgeSeconds: 12,
    anomalies: { staleLeaseCount: 0, staleHeartbeatCount: 0, stuckProcessingCount: 0 },
    deadLetters: { last5m: 0 },
    worker: { running: true, heartbeatStale: false, workerId: 'w1', lastTickAt: Date.now(), lastTickError: '', lastTickErrorAt: 0, heartbeatAgeMs: 2, metrics: {} },
    alerts: [],
    thresholds: {},
    prometheus: 'outbox_pending_count 2\n',
  }));
  const res = makeRes();
  await controller.getOutboxMetrics(
    makeReq({ user: { uid: 'a3', role: 'admin' }, query: { format: 'prometheus' } }),
    res,
    () => {},
  );
  assert(res.statusCode === 200, 'prometheus response should succeed');
  assert((res.text || '').includes('outbox_pending_count 2'), 'prometheus payload should include expected metric');
}

function testServerMountSecurity() {
  const serverJs = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(
    serverJs.includes("'/health/outbox-worker'") &&
      serverJs.includes('authMiddleware') &&
      serverJs.includes('requireAdmin'),
    'outbox worker health endpoint must be admin-protected',
  );
  assert(
    serverJs.includes("'/metrics/outbox'") &&
      serverJs.includes('outboxMetricsLimiter'),
    'outbox metrics endpoint must be rate-limited and mounted',
  );
}

async function run() {
  await testUnauthorizedAccess();
  await testStaleWorkerDetection();
  await testDeadLetterThresholdAlertsPresent();
  await testPrometheusFormat();
  testServerMountSecurity();
  // eslint-disable-next-line no-console
  console.log('outbox-metrics-security tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('outbox-metrics-security tests failed:', error);
  process.exit(1);
});
