let cron = null;

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

  scheduler.schedule(config.vendorSettlementCron, async () => {
    try {
      await runAutomaticSettlements({ walletType: 'vendor' });
    } catch (error) {
      console.error('Vendor settlement cron failed:', error);
    }
  });

  scheduler.schedule(config.riderSettlementCron, async () => {
    try {
      await runAutomaticSettlements({ walletType: 'rider' });
    } catch (error) {
      console.error('Rider settlement cron failed:', error);
    }
  });
}

module.exports = {
  scheduleFinanceCrons,
};
