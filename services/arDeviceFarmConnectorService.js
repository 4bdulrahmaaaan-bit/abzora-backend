function getConnectorMode() {
  return (process.env.AR_DEVICE_FARM_MODE || 'local').toLowerCase();
}

async function submitDeviceLabRun({ runName, scenario, deviceMatrix }) {
  const mode = getConnectorMode();
  if (mode === 'local') {
    return {
      provider: 'local-simulator',
      externalRunId: `local-${Date.now()}`,
      accepted: true,
      runName,
      scenario,
      devices: Array.isArray(deviceMatrix) ? deviceMatrix.length : 0,
    };
  }

  // Placeholder contract for BrowserStack/Firebase Test Lab/AWS Device Farm integrations.
  return {
    provider: mode,
    externalRunId: `${mode}-${Date.now()}`,
    accepted: true,
    runName,
    scenario,
    devices: Array.isArray(deviceMatrix) ? deviceMatrix.length : 0,
  };
}

module.exports = {
  submitDeviceLabRun,
  getConnectorMode,
};
