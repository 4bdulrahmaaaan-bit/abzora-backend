let cron = null;
const scheduledTasks = [];

const { financeConfig, runAutomaticSettlements } = require('./financeService');

function getCron() {
  if (!cron) {
    // Lazy require so local code can still lint even before dependencies refresh.
    cron = require('node-cron');
  }
  return cron;
}

function scheduleFinanceCrons() {
  const scheduler = getCron();
  const config = financeConfig();

  const vendorTask = scheduler.schedule(config.vendorSettlementCron, async () => {
    try {
      await runAutomaticSettlements({ walletType: 'vendor' });
    } catch (error) {
      console.error('Vendor settlement cron failed:', error);
    }
  });
  scheduledTasks.push(vendorTask);

  const riderTask = scheduler.schedule(config.riderSettlementCron, async () => {
    try {
      await runAutomaticSettlements({ walletType: 'rider' });
    } catch (error) {
      console.error('Rider settlement cron failed:', error);
    }
  });
  scheduledTasks.push(riderTask);
}

function stopFinanceCrons() {
  while (scheduledTasks.length > 0) {
    const task = scheduledTasks.pop();
    try {
      task?.stop?.();
      task?.destroy?.();
    } catch (_) {
      // Security hardening: best-effort shutdown avoids crash loops on exit.
    }
  }
}

function getFinanceCronStatus() {
  return {
    running: scheduledTasks.length > 0,
    taskCount: scheduledTasks.length,
  };
}

module.exports = {
  getFinanceCronStatus,
  scheduleFinanceCrons,
  stopFinanceCrons,
};
