const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireRoles } = require('../middleware/authorizationMiddleware');
const { validateQuery } = require('../validation/schemaValidator');
const { productListQuerySchema } = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  createProduct,
  deleteProduct,
  generateProductArAsset,
  getFilterConfiguration,
  getProduct,
  listProducts,
  updateProduct,
} = require('../controllers/productController');

const router = express.Router();

router.get('/', validateQuery(productListQuerySchema), listProducts);
router.get('/filters/config', getFilterConfiguration);
router.post('/:id/ar-asset/generate', authMiddleware, requireRoles('vendor', 'admin', 'super_admin'), generateProductArAsset);
router.get('/:id', getProduct);
router.post('/', authMiddleware, requireRoles('vendor', 'admin', 'super_admin'), createProduct);
router.put('/:id', authMiddleware, requireRoles('vendor', 'admin', 'super_admin'), updateProduct);
router.delete('/:id', authMiddleware, requireRoles('vendor', 'admin', 'super_admin'), deleteProduct);

module.exports = router;
