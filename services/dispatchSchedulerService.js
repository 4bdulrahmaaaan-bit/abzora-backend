const { assignBatches } = require('./dispatchEngineService');

let schedulerHandle = null;

async function runDispatchCycle() {
  try {
    await assignBatches({
      city: '',
      actor: { uid: 'system', role: 'admin' },
    });
  } catch (error) {
    console.warn('Dispatch scheduler cycle failed:', error.message);
  }
}

function startDispatchScheduler() {
  if (process.env.DISPATCH_SCHEDULER_ENABLED === 'false') {
    return;
  }
  if (schedulerHandle) {
    return;
  }

  const intervalSeconds = Math.min(
    60,
    Math.max(30, Number(process.env.DISPATCH_UPDATE_INTERVAL_SEC || 45)),
  );
  schedulerHandle = setInterval(runDispatchCycle, intervalSeconds * 1000);
  schedulerHandle.unref?.();
}

function stopDispatchScheduler() {
  if (!schedulerHandle) {
    return;
  }
  clearInterval(schedulerHandle);
  schedulerHandle = null;
}

function getDispatchSchedulerStatus() {
  return {
    running: Boolean(schedulerHandle),
  };
}

module.exports = {
  getDispatchSchedulerStatus,
  startDispatchScheduler,
  stopDispatchScheduler,
};
