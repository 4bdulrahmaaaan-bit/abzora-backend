const Product = require('../models/Product');
const ArGarmentCertificationJob = require('../models/ArGarmentCertificationJob');
const logger = require('./structuredLogger');
const { validateGarmentProduct } = require('./arGarmentValidatorService');

let running = false;
let loopHandle = null;
let inFlight = false;
const health = {
  running: false,
  processedJobs: 0,
  failedJobs: 0,
  lastJobId: '',
  lastError: '',
  lastErrorAt: '',
};

function buildLodPlan(product) {
  const model3d = product.model3d || '';
  if (!model3d) {
    return {
      eligible: false,
      lod0: '',
      lod1: '',
      lod2: '',
    };
  }
  const base = model3d.replace(/\.glb(\?.*)?$/i, '');
  return {
    eligible: true,
    lod0: model3d,
    lod1: `${base}_lod1.glb`,
    lod2: `${base}_lod2.glb`,
  };
}

async function processCertificationJob() {
  if (inFlight) return;
  inFlight = true;
  try {
    const job = await ArGarmentCertificationJob.findOneAndUpdate(
      { status: 'queued' },
      { $set: { status: 'running' } },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!job) return;

    const products = job.productIds?.length
      ? await Product.find({ _id: { $in: job.productIds } })
        .select('_id model3d images garmentConfig')
        .populate('garmentConfig.templateId')
      : await Product.find({ isActive: true })
        .select('_id model3d images garmentConfig')
        .populate('garmentConfig.templateId')
        .limit(500);

    const findings = [];
    for (const product of products) {
      const validation = await validateGarmentProduct(product);
      const lod = buildLodPlan(product);
      findings.push({
        productId: product._id.toString(),
        certified: validation.certified,
        qualityScore: validation.qualityScore,
        findings: validation.findings,
        modelUrl: validation.modelUrl,
        textureUrl: validation.textureUrl,
        modelBytes: validation.modelBytes,
        textureBytes: validation.textureBytes,
        triangleEstimate: validation.triangleEstimate,
        tierBudgets: validation.tierBudgets,
        lod,
      });
    }

    const certified = findings.filter((item) => item.certified).length;
    const rejected = findings.length - certified;
    const generatedLod = findings.filter((item) => item.lod?.eligible).length;

    job.findings = findings.slice(0, 1000);
    job.summary = {
      scanned: findings.length,
      certified,
      rejected,
      generatedLod,
    };
    job.status = 'completed';
    await job.save();

    health.processedJobs += 1;
    health.lastJobId = job._id.toString();
  } catch (error) {
    health.failedJobs += 1;
    health.lastError = String(error?.message || error);
    health.lastErrorAt = new Date().toISOString();
    logger.warn('ar_garment_cert_worker_failed', {
      module: 'arGarmentCertificationWorkerService',
      message: health.lastError,
    });
  } finally {
    inFlight = false;
  }
}

function startArGarmentCertificationWorker() {
  if (running) return;
  running = true;
  health.running = true;
  loopHandle = setInterval(
    () => { processCertificationJob(); },
    Number(process.env.AR_GARMENT_CERT_WORKER_INTERVAL_MS || 5000),
  );
  loopHandle.unref?.();
}

function stopArGarmentCertificationWorker() {
  running = false;
  health.running = false;
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

function getArGarmentCertificationWorkerHealth() {
  return { ...health, inFlight };
}

module.exports = {
  startArGarmentCertificationWorker,
  stopArGarmentCertificationWorker,
  getArGarmentCertificationWorkerHealth,
};
