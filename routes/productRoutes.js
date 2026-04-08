const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createProduct,
  deleteProduct,
  generateProductArAsset,
  getProduct,
  listProducts,
  updateProduct,
} = require('../controllers/productController');

const router = express.Router();

router.get('/', listProducts);
router.post('/:id/ar-asset/generate', authMiddleware, generateProductArAsset);
router.get('/:id', getProduct);
router.post('/', authMiddleware, createProduct);
router.put('/:id', authMiddleware, updateProduct);
router.delete('/:id', authMiddleware, deleteProduct);

module.exports = router;
