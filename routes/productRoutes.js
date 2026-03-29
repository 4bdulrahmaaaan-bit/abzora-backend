const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} = require('../controllers/productController');

const router = express.Router();

router.get('/', listProducts);
router.get('/:id', getProduct);
router.post('/', authMiddleware, createProduct);
router.put('/:id', authMiddleware, updateProduct);
router.delete('/:id', authMiddleware, deleteProduct);

module.exports = router;
