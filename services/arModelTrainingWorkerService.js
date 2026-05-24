const ArFitModelRun = require('../models/ArFitModelRun');
const ArFitModelArtifact = require('../models/ArFitModelArtifact');
const logger = require('./structuredLogger');
const { executeTrainingRun } = require('./arModelTrainingExecutorService');

const health = {
  running: false,
  loopCount: 0,
  processed: 0,
  failed: 0,
  lastRunId: '',
  lastError: '',
  lastErrorAt: '',
};

let loopHandle = null;
let inFlight = false;

async function processQueuedRun() {
  if (inFlight) return;
  inFlight = true;
  try {
    const run = await ArFitModelRun.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'training' } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!run) return;

    const modelVersion = run.modelVersion || `fit-${Date.now().toString(36)}`;
    const result = await executeTrainingRun({
      modelVersion,
      datasetVersion: run.datasetVersion,
      trainingConfig:
        run.trainingConfig && typeof run.trainingConfig === 'object'
          ? run.trainingConfig
          : {},
    });

    run.modelVersion = modelVersion;
    run.metrics = {
      ...result.metrics,
      gatePassed:
        Number(result.metrics.weightedAccuracy || 0) >= 0.82
        && Number(result.metrics.calibrationError || 1) <= 0.12
        && Number(result.metrics.mae || 1) <= 0.18,
    };
    run.status = 'evaluated';
    await run.save();

    const artifacts = [
      ['weights', result.artifacts.weights, { datasetVersion: run.datasetVersion }],
      ['feature_map', result.artifacts.featureMap, { datasetVersion: run.datasetVersion }],
      ['metrics', result.artifacts.metrics, { metrics: result.metrics }],
      ['calibration_map', result.artifacts.calibrationMap, { calibrationError: result.metrics.calibrationError }],
      ['eval_report', result.artifacts.evalReport, { trainSize: result.trainSize, validationSize: result.validationSize }],
    ];
    await ArFitModelArtifact.insertMany(
      artifacts.map(([artifactType, artifact, metadata]) => ({
        runId: run._id,
        modelVersion,
        artifactType,
        uri: artifact.uri,
        checksum: artifact.checksum,
        bytes: artifact.bytes,
        metadata,
      })),
    );

    health.processed += 1;
    health.lastRunId = run._id.toString();
  } catch (error) {
    health.failed += 1;
    health.lastError = String(error?.message || error);
    health.lastErrorAt = new Date().toISOString();
    logger.warn('ar_model_training_worker_failed', {
      module: 'arModelTrainingWorkerService',
      message: health.lastError,
    });
  } finally {
    inFlight = false;
  }
}

function startArModelTrainingWorker() {
  if (health.running) return;
  health.running = true;
  loopHandle = setInterval(async () => {
    health.loopCount += 1;
    await processQueuedRun();
  }, Number(process.env.AR_MODEL_WORKER_INTERVAL_MS || 4000));
  loopHandle.unref?.();
}

function stopArModelTrainingWorker() {
  health.running = false;
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

function getArModelTrainingWorkerHealth() {
  return { ...health, inFlight };
}

module.exports = {
  startArModelTrainingWorker,
  stopArModelTrainingWorker,
  getArModelTrainingWorkerHealth,
};
