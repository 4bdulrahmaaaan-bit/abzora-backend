const mongoose = require('mongoose');

const ArFitModelRun = require('../models/ArFitModelRun');
const ArGarmentCertificationJob = require('../models/ArGarmentCertificationJob');
const ArDeviceLabRun = require('../models/ArDeviceLabRun');
const {
  createFitModelRun,
  evaluateFitModelRun,
  rolloutFitModelRun,
  createGarmentCertificationJob,
  createDeviceLabRun,
  getArEnterpriseSummary,
  getFitModelRegistry,
  getFitModelArtifacts,
} = require('../services/arEnterpriseOpsService');
const {
  getArModelTrainingWorkerHealth,
} = require('../services/arModelTrainingWorkerService');
const {
  getArGarmentCertificationWorkerHealth,
} = require('../services/arGarmentCertificationWorkerService');

function normalizeId(value) {
  const id = value?.toString().trim() || '';
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

async function createFitRun(req, res, next) {
  try {
    const run = await createFitModelRun(req.body || {}, req.user?.uid || '');
    res.status(201).json({ success: true, data: run });
  } catch (error) {
    next(error);
  }
}

async function listFitRuns(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
    const runs = await ArFitModelRun.find({}).sort({ createdAt: -1 }).limit(limit);
    res.status(200).json({ success: true, data: runs });
  } catch (error) {
    next(error);
  }
}

async function evaluateFitRun(req, res, next) {
  try {
    const id = normalizeId(req.params?.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid run id.' });
    }
    const run = await evaluateFitModelRun(id, req.body || {});
    if (!run) {
      return res.status(404).json({ success: false, message: 'Run not found.' });
    }
    return res.status(200).json({ success: true, data: run });
  } catch (error) {
    return next(error);
  }
}

async function rolloutFitRun(req, res, next) {
  try {
    const id = normalizeId(req.params?.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid run id.' });
    }
    const run = await rolloutFitModelRun(id, req.body || {});
    if (!run) {
      return res.status(404).json({ success: false, message: 'Run not found.' });
    }
    if (run.blocked) {
      return res.status(409).json({ success: false, message: run.reason || 'Rollout blocked.' });
    }
    return res.status(200).json({ success: true, data: run });
  } catch (error) {
    return next(error);
  }
}

async function listFitRegistry(req, res, next) {
  try {
    const records = await getFitModelRegistry();
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
}

async function listFitArtifacts(req, res, next) {
  try {
    const modelVersion = req.query?.modelVersion?.toString().trim() || '';
    const records = await getFitModelArtifacts(modelVersion);
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
}

async function getArOpsWorkerHealth(req, res, next) {
  try {
    res.status(200).json({
      success: true,
      data: {
        modelTraining: getArModelTrainingWorkerHealth(),
        garmentCertification: getArGarmentCertificationWorkerHealth(),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function createGarmentJob(req, res, next) {
  try {
    const job = await createGarmentCertificationJob(req.body || {}, req.user?.uid || '');
    res.status(201).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
}

async function listGarmentJobs(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
    const jobs = await ArGarmentCertificationJob.find({}).sort({ createdAt: -1 }).limit(limit);
    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
}

async function createDeviceLab(req, res, next) {
  try {
    const run = await createDeviceLabRun(req.body || {}, req.user?.uid || '');
    res.status(201).json({ success: true, data: run });
  } catch (error) {
    next(error);
  }
}

async function listDeviceLabs(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
    const runs = await ArDeviceLabRun.find({}).sort({ createdAt: -1 }).limit(limit);
    res.status(200).json({ success: true, data: runs });
  } catch (error) {
    next(error);
  }
}

async function getEnterpriseSummary(req, res, next) {
  try {
    const days = Number(req.query?.days || 14);
    const summary = await getArEnterpriseSummary(days);
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createFitRun,
  listFitRuns,
  evaluateFitRun,
  rolloutFitRun,
  createGarmentJob,
  listGarmentJobs,
  createDeviceLab,
  listDeviceLabs,
  getEnterpriseSummary,
  listFitRegistry,
  listFitArtifacts,
  getArOpsWorkerHealth,
};
