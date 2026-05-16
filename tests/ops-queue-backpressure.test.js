const assert = require('node:assert/strict');
const path = require('path');

const queuePath = path.join(__dirname, '..', 'services', 'opsQueueService.js');

function reloadQueue() {
  delete require.cache[require.resolve(queuePath)];
  return require(queuePath);
}

async function drain(queue) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const value = await queue.dequeueAlertDetailed();
    if (!value) break;
  }
}

async function testQueueOverloadProtection() {
  process.env.REDIS_DISABLED = 'true';
  process.env.OPS_QUEUE_GLOBAL_MAX = '100';
  process.env.OPS_QUEUE_LOW_MAX = '10';
  process.env.OPS_QUEUE_OVERLOAD_POLICY = 'defer';
  process.env.OPS_QUEUE_DEFER_MS = '5000';

  const queue = reloadQueue();
  await drain(queue);

  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await queue.enqueueAlert({ alertId: `l${i}`, severity: 'LOW', jobClass: 'analytics' });
  }
  const lowResult = await queue.enqueueAlert({ alertId: 'l1', severity: 'LOW', jobClass: 'analytics' });

  assert.equal(lowResult.accepted, true, 'low priority should be deferred, not accepted directly');
  assert.equal(lowResult.state, 'retry_scheduled', 'overloaded low priority should be moved to delayed retry queue');
}

async function testPriorityInversionProtection() {
  process.env.REDIS_DISABLED = 'true';
  process.env.OPS_QUEUE_GLOBAL_MAX = '2';
  process.env.OPS_QUEUE_OVERLOAD_POLICY = 'reject';

  const queue = reloadQueue();
  await drain(queue);

  await queue.enqueueAlert({ alertId: 'l2', severity: 'LOW' });
  await queue.enqueueAlert({ alertId: 'l3', severity: 'LOW' });
  const criticalResult = await queue.enqueueAlert({ alertId: 'c2', severity: 'CRITICAL', jobClass: 'payment' });
  assert.equal(criticalResult.accepted, true, 'critical jobs must bypass overload rejection');

  const first = await queue.dequeueAlertDetailed();
  assert.equal(first.alertId, 'c2', 'critical jobs should dequeue ahead of low-priority jobs');
}

async function testRetryStormControl() {
  process.env.REDIS_DISABLED = 'true';
  process.env.OPS_QUEUE_GLOBAL_MAX = '100';
  process.env.OPS_QUEUE_RETRY_PROMOTE_PER_TICK = '2';
  process.env.OPS_QUEUE_RETRY_JITTER_MS = '0';
  const queue = reloadQueue();
  await drain(queue);

  const soon = Date.now() + 5;
  await queue.enqueueAlert({ alertId: 'r1', severity: 'LOW', isRetry: true, retryAt: soon });
  await queue.enqueueAlert({ alertId: 'r2', severity: 'LOW', isRetry: true, retryAt: soon });
  await queue.enqueueAlert({ alertId: 'r3', severity: 'LOW', isRetry: true, retryAt: soon });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const promoted = await queue.promoteDueRetries(2);
  assert.equal(promoted, 2, 'retry promotion should cap per tick to prevent retry storms');
}

async function testWorkerStarvationProtection() {
  process.env.REDIS_DISABLED = 'true';
  process.env.OPS_QUEUE_GLOBAL_MAX = '100';
  const queue = reloadQueue();
  await drain(queue);

  await queue.enqueueAlert({ alertId: 'low-a', severity: 'LOW' });
  await queue.enqueueAlert({ alertId: 'low-b', severity: 'LOW' });
  await queue.enqueueAlert({ alertId: 'high-a', severity: 'HIGH' });

  const one = await queue.dequeueAlertDetailed();
  assert.equal(one.alertId, 'high-a', 'higher priority jobs should not starve behind low queue depth');
}

async function testRecoveryAfterSaturation() {
  process.env.REDIS_DISABLED = 'true';
  process.env.OPS_QUEUE_GLOBAL_MAX = '1';
  process.env.OPS_QUEUE_OVERLOAD_POLICY = 'defer';
  process.env.OPS_QUEUE_DEFER_MS = '20';
  process.env.OPS_QUEUE_RETRY_JITTER_MS = '0';

  const queue = reloadQueue();
  await drain(queue);
  await queue.enqueueAlert({ alertId: 'base', severity: 'LOW' });
  await queue.enqueueAlert({ alertId: 'defer-me', severity: 'LOW' });
  await queue.dequeueAlertDetailed();

  await new Promise((resolve) => setTimeout(resolve, 30));
  await queue.promoteDueRetries(5);
  const recovered = await queue.dequeueAlertDetailed();
  assert.equal(recovered.alertId, 'defer-me', 'deferred jobs should recover after saturation clears');
}

async function run() {
  await testQueueOverloadProtection();
  await testPriorityInversionProtection();
  await testRetryStormControl();
  await testWorkerStarvationProtection();
  await testRecoveryAfterSaturation();
  // eslint-disable-next-line no-console
  console.log('ops-queue-backpressure tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('ops-queue-backpressure tests failed:', error);
  process.exitCode = 1;
});
