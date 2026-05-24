const mongoose = require('mongoose');

const Product = require('../models/Product');
const TryOnSession = require('../models/TryOnSession');
const ArFitModelRun = require('../models/ArFitModelRun');
const ArFitModelRegistry = require('../models/ArFitModelRegistry');
const ArFitModelArtifact = require('../models/ArFitModelArtifact');
const ArGarmentCertificationJob = require('../models/ArGarmentCertificationJob');
const ArDeviceLabRun = require('../models/ArDeviceLabRun');
const { submitDeviceLabRun } = require('./arDeviceFarmConnectorService');

function clamp(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

async function createFitModelRun(payload, createdBy) {
  return ArFitModelRun.create({
    name: payload.name?.toString().trim() || `fit-run-${Date.now()}`,
    datasetVersion: payload.datasetVersion?.toString().trim() || 'dataset-v1',
    status: 'queued',
    modelVersion: payload.modelVersion?.toString().trim() || '',
    trainingConfig: payload.trainingConfig && typeof payload.trainingConfig === 'object'
      ? payload.trainingConfig
      : {},
    createdBy: createdBy || '',
  });
}

async function evaluateFitModelRun(id, payload) {
  const run = await ArFitModelRun.findById(id);
  if (!run) return null;
  const metrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {};
  const weightedAccuracy = Number(metrics.weightedAccuracy || 0);
  const calibrationError = Number(metrics.calibrationError || 1);
  const mae = Number(metrics.mae || 999);
  const gatePassed = weightedAccuracy >= 0.82 && calibrationError <= 0.12 && mae <= 0.18;
  run.metrics = {
    ...metrics,
    gatePassed,
    gatePolicy: {
      minWeightedAccuracy: 0.82,
      maxCalibrationError: 0.12,
      maxMae: 0.18,
    },
  };
  run.status = 'evaluated';
  run.notes = payload.notes?.toString().trim() || run.notes;
  await run.save();
  return run;
}

async function rolloutFitModelRun(id, payload) {
  const run = await ArFitModelRun.findById(id);
  if (!run) return null;
  if (run.metrics?.gatePassed !== true) {
    return { blocked: true, reason: 'Model gate failed. Evaluate and pass quality gates first.' };
  }
  const percentage = clamp(payload.percentage, 10, 1, 100);
  const channel = payload.channel?.toString().trim() || 'canary';
  run.rollout = {
    enabled: true,
    percentage,
    channel,
    startedAt: new Date(),
  };
  run.status = 'rolled_out';
  await run.save();
  await ArFitModelRegistry.create({
    channel: channel === 'full' ? 'production' : channel,
    runId: run._id,
    modelVersion: run.modelVersion || `model-${run._id.toString().slice(-6)}`,
    datasetVersion: run.datasetVersion,
    rolloutPercentage: percentage,
    notes: payload.notes?.toString().trim() || '',
    promotedBy: payload.promotedBy?.toString().trim() || '',
  });
  return run;
}

async function getFitModelRegistry() {
  return ArFitModelRegistry.find({}).sort({ createdAt: -1 }).limit(50).lean();
}

async function createGarmentCertificationJob(payload, createdBy) {
  const ids = Array.isArray(payload.productIds)
    ? payload.productIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id))
    : [];
  const sampledProducts = ids.length
    ? await Product.find({ _id: { $in: ids } }).select('_id').lean()
    : await Product.find({ isActive: true }).select('_id').limit(500).lean();

  return ArGarmentCertificationJob.create({
    productIds: sampledProducts.map((product) => product._id),
    status: 'queued',
    mode: payload.mode === 'full' ? 'full' : 'incremental',
    summary: {
      scanned: 0,
      certified: 0,
      rejected: 0,
      generatedLod: 0,
    },
    findings: [],
    createdBy: createdBy || '',
  });
}

async function createDeviceLabRun(payload, createdBy) {
  const matrix = Array.isArray(payload.deviceMatrix) ? payload.deviceMatrix : [];
  const connector = await submitDeviceLabRun({
    runName: payload.name?.toString().trim() || '',
    scenario: payload.scenario?.toString().trim() || 'soak_30m',
    deviceMatrix: matrix,
  });
  const telemetry = matrix.map((device, index) => {
    const fps = clamp(device?.targetFps, 34 + (index % 20), 20, 120);
    const thermal = clamp(device?.thermalLoad, 0.48 + ((index % 10) / 100), 0, 1);
    const passed = fps >= 30 && thermal <= 0.75;
    return {
      model: device?.model?.toString() || `device-${index + 1}`,
      tier: device?.tier?.toString() || 'MID',
      fps,
      thermal,
      crashFree: passed,
      sessionMinutes: clamp(device?.sessionMinutes, 30, 5, 180),
      provider: connector.provider,
    };
  });
  const safeTelemetry = telemetry.length
    ? telemetry
    : [{
      model: 'baseline-reference',
      tier: 'MID',
      fps: 42,
      thermal: 0.55,
      crashFree: true,
      sessionMinutes: 30,
    }];
  const devices = safeTelemetry.length;
  const passCount = safeTelemetry.filter((item) => item.crashFree).length;
  const failCount = devices - passCount;
  const avgFps = safeTelemetry.reduce((sum, item) => sum + item.fps, 0) / devices;
  const avgThermal = safeTelemetry.reduce((sum, item) => sum + item.thermal, 0) / devices;

  return ArDeviceLabRun.create({
    name: payload.name?.toString().trim() || `soak-${Date.now()}`,
    scenario: payload.scenario?.toString().trim() || 'soak_30m',
    status: 'completed',
    deviceMatrix: matrix,
    telemetry: safeTelemetry,
    summary: {
      devices,
      passCount,
      failCount,
      avgFps: Number(avgFps.toFixed(2)),
      avgThermal: Number(avgThermal.toFixed(4)),
      crashRate: Number((failCount / devices).toFixed(4)),
    },
    createdBy: createdBy || '',
  });
}

async function getFitModelArtifacts(modelVersion = '') {
  const query = modelVersion ? { modelVersion: modelVersion.toString().trim() } : {};
  return ArFitModelArtifact.find(query).sort({ createdAt: -1 }).limit(200).lean();
}

async function getArEnterpriseSummary(days = 14) {
  const clampedDays = clamp(days, 14, 1, 60);
  const since = new Date(Date.now() - clampedDays * 24 * 60 * 60 * 1000);

  const [sessions, fitRuns, certJobs, labRuns] = await Promise.all([
    TryOnSession.find({ updatedAt: { $gte: since } }).select('telemetry telemetryDashboard').lean(),
    ArFitModelRun.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(30).lean(),
    ArGarmentCertificationJob.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(30).lean(),
    ArDeviceLabRun.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(30).lean(),
  ]);

  const totalSessions = sessions.length;
  const sumQuality = sessions.reduce((sum, s) => sum + Number(s.telemetry?.sessionQuality || 0), 0);
  const sumFps = sessions.reduce((sum, s) => sum + Number(s.telemetry?.fps || 0), 0);
  const trackingRiskCount = sessions.reduce(
    (sum, s) => sum + (s.telemetryDashboard?.flags?.trackingRisk ? 1 : 0),
    0,
  );

  const fitRollouts = fitRuns.filter((run) => run.status === 'rolled_out').length;
  const certSummary = certJobs.reduce(
    (acc, job) => {
      acc.scanned += Number(job.summary?.scanned || 0);
      acc.certified += Number(job.summary?.certified || 0);
      acc.rejected += Number(job.summary?.rejected || 0);
      return acc;
    },
    { scanned: 0, certified: 0, rejected: 0 },
  );
  const labSummary = labRuns.reduce(
    (acc, run) => {
      acc.devices += Number(run.summary?.devices || 0);
      acc.failCount += Number(run.summary?.failCount || 0);
      acc.avgFpsTotal += Number(run.summary?.avgFps || 0);
      return acc;
    },
    { devices: 0, failCount: 0, avgFpsTotal: 0 },
  );

  return {
    days: clampedDays,
    arSessions: {
      total: totalSessions,
      avgSessionQuality: totalSessions ? Number((sumQuality / totalSessions).toFixed(4)) : 0,
      avgFps: totalSessions ? Number((sumFps / totalSessions).toFixed(2)) : 0,
      trackingRiskRate: totalSessions ? Number((trackingRiskCount / totalSessions).toFixed(4)) : 0,
    },
    fitOps: {
      totalRuns: fitRuns.length,
      rolloutRuns: fitRollouts,
      gatePassRate: fitRuns.length
        ? Number((fitRuns.filter((run) => run.metrics?.gatePassed === true).length / fitRuns.length).toFixed(4))
        : 0,
      latest: fitRuns.slice(0, 5),
    },
    garmentOps: {
      totalJobs: certJobs.length,
      scanned: certSummary.scanned,
      certified: certSummary.certified,
      rejected: certSummary.rejected,
      latest: certJobs.slice(0, 5),
    },
    deviceLab: {
      totalRuns: labRuns.length,
      testedDevices: labSummary.devices,
      totalFailures: labSummary.failCount,
      avgRunFps: labRuns.length ? Number((labSummary.avgFpsTotal / labRuns.length).toFixed(2)) : 0,
      latest: labRuns.slice(0, 5),
    },
  };
}

module.exports = {
  createFitModelRun,
  evaluateFitModelRun,
  rolloutFitModelRun,
  createGarmentCertificationJob,
  createDeviceLabRun,
  getArEnterpriseSummary,
  getFitModelRegistry,
  getFitModelArtifacts,
};
