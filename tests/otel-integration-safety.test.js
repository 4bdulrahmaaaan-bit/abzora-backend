const assert = require('assert');
const path = require('path');

const servicePath = path.join(__dirname, '..', 'services', 'otelService.js');

async function testDisabledMode() {
  process.env.OTEL_ENABLED = 'false';
  delete require.cache[require.resolve(servicePath)];
  const otel = require(servicePath);
  await otel.startOpenTelemetry();
  const health = otel.getOtelHealth();
  assert(health.enabled === false, 'otel should be disabled when OTEL_ENABLED=false');
  assert(health.started === false, 'otel should not start in disabled mode');
  await otel.shutdownOpenTelemetry();
}

async function testGracefulShutdownWithoutStart() {
  process.env.OTEL_ENABLED = 'false';
  delete require.cache[require.resolve(servicePath)];
  const otel = require(servicePath);
  await otel.shutdownOpenTelemetry();
  const health = otel.getOtelHealth();
  assert(health.started === false, 'shutdown should be safe before startup');
}

async function run() {
  await testDisabledMode();
  await testGracefulShutdownWithoutStart();
  // eslint-disable-next-line no-console
  console.log('otel-integration-safety tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('otel-integration-safety tests failed:', error);
  process.exit(1);
});

