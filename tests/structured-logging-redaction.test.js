const assert = require('assert');
const path = require('path');

const logger = require(path.join(__dirname, '..', 'services', 'structuredLogger'));
const telemetry = require(path.join(__dirname, '..', 'services', 'telemetryContext'));

async function run() {
  const lines = [];
  const oldLog = console.log;
  const oldWarn = console.warn;
  const oldError = console.error;

  console.log = (line) => lines.push(line);
  console.warn = (line) => lines.push(line);
  console.error = (line) => lines.push(line);

  try {
    await telemetry.runWithContext({
      requestId: 'req-log-1',
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
    }, async () => {
      logger.info('log_redaction_test', {
        module: 'test',
        authorization: 'Bearer abc',
        password: 'top-secret',
        cookie: 'session=123',
        webhookSignature: 'sig-value',
        safeField: 'ok',
      });
    });
  } finally {
    console.log = oldLog;
    console.warn = oldWarn;
    console.error = oldError;
  }

  assert(lines.length >= 1, 'logger should emit at least one line');
  const payload = JSON.parse(lines[0]);
  assert(payload.requestId === 'req-log-1', 'logger should include requestId');
  assert(payload.traceId === '1'.repeat(32), 'logger should include traceId');
  assert(typeof payload.spanId === 'string' && payload.spanId.length > 0, 'logger should include spanId');
  assert(payload.authorization === '[redacted]', 'authorization must be redacted');
  assert(payload.password === '[redacted]', 'password must be redacted');
  assert(payload.cookie === '[redacted]', 'cookie must be redacted');
  assert(payload.webhookSignature === '[redacted]', 'webhook signature must be redacted');
  assert(payload.safeField === 'ok', 'safe fields should remain');
  // eslint-disable-next-line no-console
  console.log('structured-logging-redaction tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('structured-logging-redaction tests failed:', error);
  process.exit(1);
});
