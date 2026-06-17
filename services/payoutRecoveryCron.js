let cron = null;
const scheduledTasks = [];

const { runPayoutRecoverySweep } = require('./payoutRecoveryService');

function getCron() {
  if (!cron) {
    cron = require('node-cron');
  }
  return cron;
}

function schedulePayoutRecoveryCron() {
  const scheduler = getCron();
  const expression = process.env.PAYOUT_RECOVERY_CRON || '*/5 * * * *';

  const task = scheduler.schedule(expression, async () => {
    try {
      await runPayoutRecoverySweep({
        staleMinutes: Number(process.env.PAYOUT_RECOVERY_STALE_MINUTES || 5),
        limit: Number(process.env.PAYOUT_RECOVERY_BATCH_LIMIT || 100),
        triggeredBy: 'payout-recovery-cron',
      });
    } catch (error) {
      console.error('Payout recovery cron failed:', error);
    }
  });

  scheduledTasks.push(task);
}

function stopPayoutRecoveryCron() {
  while (scheduledTasks.length > 0) {
    const task = scheduledTasks.pop();
    try {
      task?.stop?.();
      task?.destroy?.();
    } catch (_) {
      // Best effort shutdown only.
    }
  }
}

function getPayoutRecoveryCronStatus() {
  return {
    running: scheduledTasks.length > 0,
    taskCount: scheduledTasks.length,
  };
}

module.exports = {
  getPayoutRecoveryCronStatus,
  schedulePayoutRecoveryCron,
  stopPayoutRecoveryCron,
};
