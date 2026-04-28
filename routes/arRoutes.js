const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireRoles } = require('../middleware/authorizationMiddleware');
const { generateProductArAsset } = require('../controllers/productController');
const { validateBody } = require('../validation/schemaValidator');
const {
  fitScoreSchema,
  saveLookSchema,
  tryOnSessionSchema,
  upsertGarmentTemplateSchema,
} = require('../validation/schemas/arSchemas');
const {
  getGarmentTemplate,
  listGarmentTemplates,
  upsertGarmentTemplate,
} = require('../controllers/garmentTemplateController');
const {
  createTryOnSession,
  getFitAssessment,
  saveTryOnLook,
  getTryOnProduct,
  getTryOnGarmentManifest,
} = require('../controllers/tryOnController');

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
router.post('/templates/upsert', validateBody(upsertGarmentTemplateSchema), upsertGarmentTemplate);
router.post('/looks', validateBody(saveLookSchema), saveTryOnLook);

module.exports = router;
