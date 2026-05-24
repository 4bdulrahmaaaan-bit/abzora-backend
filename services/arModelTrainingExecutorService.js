const { loadDataset, writeArtifact } = require('./arModelArtifactStorageService');

const FEATURE_KEYS = [
  'shoulderWidth',
  'torsoRatio',
  'hipWaistRatio',
  'poseStability',
  'garmentEaseAllowance',
  'fabricStretch',
];

function toFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function synthesizeDataset(size = 2000) {
  const rows = [];
  for (let i = 0; i < size; i += 1) {
    const shoulderWidth = 0.35 + (Math.random() * 0.35);
    const torsoRatio = 0.85 + (Math.random() * 0.4);
    const hipWaistRatio = 0.8 + (Math.random() * 0.5);
    const poseStability = 0.45 + (Math.random() * 0.5);
    const garmentEaseAllowance = -0.1 + (Math.random() * 0.35);
    const fabricStretch = Math.random();
    const noise = (Math.random() - 0.5) * 0.05;
    const fitConfidence = Math.max(
      0,
      Math.min(
        1,
        0.16
          + 0.24 * shoulderWidth
          + 0.17 * torsoRatio
          + 0.18 * hipWaistRatio
          + 0.23 * poseStability
          + 0.11 * fabricStretch
          - 0.08 * Math.abs(garmentEaseAllowance)
          + noise,
      ),
    );
    rows.push({
      shoulderWidth,
      torsoRatio,
      hipWaistRatio,
      poseStability,
      garmentEaseAllowance,
      fabricStretch,
      fitConfidence,
    });
  }
  return rows;
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const normalized = {};
    for (const key of FEATURE_KEYS) {
      normalized[key] = toFinite(row[key]);
    }
    normalized.target = Math.max(0, Math.min(1, toFinite(row.fitConfidence, 0.5)));
    return normalized;
  });
}

function splitTrainValidation(rows, ratio = 0.8) {
  const trainSize = Math.max(1, Math.floor(rows.length * ratio));
  return {
    train: rows.slice(0, trainSize),
    validation: rows.slice(trainSize),
  };
}

function predict(weights, row) {
  let output = toFinite(weights.bias);
  for (const key of FEATURE_KEYS) {
    output += toFinite(weights[key]) * toFinite(row[key]);
  }
  return Math.max(0, Math.min(1, output));
}

function fitLinearModel(trainRows, { learningRate = 0.05, epochs = 120 } = {}) {
  const weights = { bias: 0.2 };
  for (const key of FEATURE_KEYS) {
    weights[key] = 0;
  }

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const row of trainRows) {
      const prediction = predict(weights, row);
      const error = prediction - row.target;
      weights.bias -= learningRate * error;
      for (const key of FEATURE_KEYS) {
        weights[key] -= learningRate * error * row[key];
      }
    }
  }
  return weights;
}

function evaluateModel(weights, rows) {
  if (!rows.length) {
    return {
      mae: 1,
      weightedAccuracy: 0,
      calibrationError: 1,
      precisionAtTopK: 0,
      recallAtTopK: 0,
    };
  }
  let absErrorSum = 0;
  let score = 0;
  let calibrationDiffSum = 0;
  let truePositive = 0;
  let predictedPositive = 0;
  let actualPositive = 0;

  for (const row of rows) {
    const p = predict(weights, row);
    const target = row.target;
    const absError = Math.abs(p - target);
    absErrorSum += absError;
    calibrationDiffSum += Math.abs(p - target);
    score += Math.max(0, 1 - absError);

    if (p >= 0.7) predictedPositive += 1;
    if (target >= 0.7) actualPositive += 1;
    if (p >= 0.7 && target >= 0.7) truePositive += 1;
  }

  const mae = absErrorSum / rows.length;
  const weightedAccuracy = score / rows.length;
  const calibrationError = calibrationDiffSum / rows.length;
  const precisionAtTopK = predictedPositive ? (truePositive / predictedPositive) : 0;
  const recallAtTopK = actualPositive ? (truePositive / actualPositive) : 0;

  return {
    mae: Number(mae.toFixed(4)),
    weightedAccuracy: Number(weightedAccuracy.toFixed(4)),
    calibrationError: Number(calibrationError.toFixed(4)),
    precisionAtTopK: Number(precisionAtTopK.toFixed(4)),
    recallAtTopK: Number(recallAtTopK.toFixed(4)),
  };
}

async function executeTrainingRun({ modelVersion, datasetVersion, trainingConfig = {} }) {
  const datasetRows = loadDataset(datasetVersion);
  const prepared = normalizeRows(datasetRows.length ? datasetRows : synthesizeDataset(2400));
  const { train, validation } = splitTrainValidation(prepared, 0.82);
  const weights = fitLinearModel(train, {
    learningRate: toFinite(trainingConfig.learningRate, 0.04),
    epochs: Math.max(20, Math.min(400, Math.floor(toFinite(trainingConfig.epochs, 160)))),
  });

  const trainMetrics = evaluateModel(weights, train);
  const validationMetrics = evaluateModel(weights, validation);
  const globalMetrics = {
    ...validationMetrics,
    trainMae: trainMetrics.mae,
    trainWeightedAccuracy: trainMetrics.weightedAccuracy,
  };

  const artifacts = {
    weights: writeArtifact({
      modelVersion,
      artifactType: 'weights',
      payload: { modelVersion, featureKeys: FEATURE_KEYS, weights },
    }),
    featureMap: writeArtifact({
      modelVersion,
      artifactType: 'feature_map',
      payload: { modelVersion, featureKeys: FEATURE_KEYS },
    }),
    metrics: writeArtifact({
      modelVersion,
      artifactType: 'metrics',
      payload: { modelVersion, datasetVersion, metrics: globalMetrics },
    }),
    calibrationMap: writeArtifact({
      modelVersion,
      artifactType: 'calibration_map',
      payload: {
        modelVersion,
        bins: [0, 0.25, 0.5, 0.75, 1.0],
        expectedError: globalMetrics.calibrationError,
      },
    }),
    evalReport: writeArtifact({
      modelVersion,
      artifactType: 'eval_report',
      payload: {
        modelVersion,
        datasetVersion,
        trainSize: train.length,
        validationSize: validation.length,
        trainingConfig,
        trainMetrics,
        validationMetrics,
      },
    }),
  };

  return {
    metrics: globalMetrics,
    artifacts,
    trainSize: train.length,
    validationSize: validation.length,
    datasetVersion,
  };
}

module.exports = {
  executeTrainingRun,
  FEATURE_KEYS,
};
