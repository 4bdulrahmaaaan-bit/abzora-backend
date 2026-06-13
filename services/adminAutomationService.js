const cron = require('node-cron');
const AdminAutomation = require('../models/AdminAutomation');

const DEFAULT_AUTOMATIONS = [
  { name: 'auto-escalate-disputes', description: 'Auto-escalate disputes unresolved for 48 hours', cronExpression: '0 0 * * *' },
  { name: 'auto-remind-pending-kyc', description: 'Remind users of pending KYC applications', cronExpression: '0 9 * * *' },
  { name: 'auto-remind-settlements', description: 'Remind admins of pending settlements', cronExpression: '0 10 * * *' },
  { name: 'auto-notify-low-inventory', description: 'Notify vendors of low stock products', cronExpression: '0 8 * * *' },
  { name: 'auto-notify-fraud-alerts', description: 'Daily summary of unhandled fraud alerts', cronExpression: '0 18 * * *' },
  { name: 'auto-remind-inactive-vendors', description: 'Remind vendors inactive for 7 days', cronExpression: '0 11 * * *' },
  { name: 'auto-remind-inactive-riders', description: 'Remind riders inactive for 7 days', cronExpression: '0 12 * * *' },
];

const activeJobs = new Map();

async function initAutomations() {
  // Ensure default automations exist
  for (const auto of DEFAULT_AUTOMATIONS) {
    await AdminAutomation.updateOne(
      { name: auto.name },
      { $setOnInsert: auto },
      { upsert: true }
    );
  }

  // Load enabled automations and start them
  const enabledAutomations = await AdminAutomation.find({ enabled: true });
  for (const automation of enabledAutomations) {
    scheduleJob(automation);
  }
}

function scheduleJob(automation) {
  if (activeJobs.has(automation.name)) {
    activeJobs.get(automation.name).stop();
  }

  const job = cron.schedule(automation.cronExpression, async () => {
    // In a real scenario, this would execute the specific logic for the automation name
    console.log(`Executing automation: ${automation.name}`);
    
    let status = 'success';
    let details = 'Executed successfully (mock)';

    // Mocking intermittent failure for realism
    if (Math.random() > 0.9) {
      status = 'failure';
      details = 'Mock failure during execution';
    }

    const updateQuery = {
      lastRunAt: new Date(),
      $push: { executionHistory: { $each: [{ status, details }], $slice: -50 } } // Keep last 50
    };

    if (status === 'success') {
      updateQuery.$inc = { successCount: 1 };
    } else {
      updateQuery.$inc = { failureCount: 1 };
    }

    await AdminAutomation.updateOne({ name: automation.name }, updateQuery);
  });

  activeJobs.set(automation.name, job);
}

function stopJob(automationName) {
  if (activeJobs.has(automationName)) {
    activeJobs.get(automationName).stop();
    activeJobs.delete(automationName);
  }
}

module.exports = {
  initAutomations,
  scheduleJob,
  stopJob,
};
