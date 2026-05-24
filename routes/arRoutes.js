const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireRoles } = require('../middleware/authorizationMiddleware');
const { generateProductArAsset } = require('../controllers/productController');
const { validateBody } = require('../validation/schemaValidator');
const {
  fitScoreSchema,
  saveLookSchema,
  tryOnSessionSchema,
  tryOnTelemetrySchema,
  upsertGarmentTemplateSchema,
} = require('../validation/schemas/arSchemas');
const {
  getGarmentTemplate,
  listGarmentTemplates,
  upsertGarmentTemplate,
} = require('../controllers/garmentTemplateController');
const {
  createTryOnSession,
  saveTryOnTelemetry,
  getTryOnTelemetrySummary,
  getFitAssessment,
  saveTryOnLook,
  getTryOnProduct,
  getTryOnGarmentManifest,
} = require('../controllers/tryOnController');
const {
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
} = require('../controllers/arEnterpriseOpsController');

const router = express.Router();

router.get('/product/:id', getTryOnProduct);
router.get('/garments/manifest', getTryOnGarmentManifest);
router.post('/fit/score', validateBody(fitScoreSchema), getFitAssessment);
router.get('/templates', listGarmentTemplates);
router.get('/templates/:id', getGarmentTemplate);

router.use(authMiddleware);
router.use('/templates/upsert', requireRoles('admin', 'super_admin', 'designer'));

router.post('/generate', (req, res, next) => {
  const productId = req.body?.productId?.toString().trim() || '';
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: 'productId is required.',
    });
  }
  req.params.id = productId;
  return generateProductArAsset(req, res, next);
});
router.post('/tryon/session', validateBody(tryOnSessionSchema), createTryOnSession);
router.post('/tryon/telemetry', validateBody(tryOnTelemetrySchema), saveTryOnTelemetry);
router.get('/tryon/telemetry/summary', requireRoles('admin', 'super_admin'), getTryOnTelemetrySummary);
router.post('/templates/upsert', validateBody(upsertGarmentTemplateSchema), upsertGarmentTemplate);
router.post('/looks', validateBody(saveLookSchema), saveTryOnLook);
router.get('/ops/enterprise/summary', requireRoles('admin', 'super_admin'), getEnterpriseSummary);
router.get('/ops/fit/runs', requireRoles('admin', 'super_admin'), listFitRuns);
router.get('/ops/fit/registry', requireRoles('admin', 'super_admin'), listFitRegistry);
router.get('/ops/fit/artifacts', requireRoles('admin', 'super_admin'), listFitArtifacts);
router.post('/ops/fit/runs', requireRoles('admin', 'super_admin'), createFitRun);
router.post('/ops/fit/runs/:id/evaluate', requireRoles('admin', 'super_admin'), evaluateFitRun);
router.post('/ops/fit/runs/:id/rollout', requireRoles('admin', 'super_admin'), rolloutFitRun);
router.get('/ops/garment/jobs', requireRoles('admin', 'super_admin'), listGarmentJobs);
router.post('/ops/garment/jobs', requireRoles('admin', 'super_admin'), createGarmentJob);
router.get('/ops/device-lab/runs', requireRoles('admin', 'super_admin'), listDeviceLabs);
router.post('/ops/device-lab/runs', requireRoles('admin', 'super_admin'), createDeviceLab);
router.get('/ops/workers/health', requireRoles('admin', 'super_admin'), getArOpsWorkerHealth);

module.exports = router;
