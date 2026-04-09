const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { generateProductArAsset } = require('../controllers/productController');
const { createTryOnSession, getTryOnProduct } = require('../controllers/tryOnController');

const router = express.Router();

router.get('/product/:id', getTryOnProduct);

router.use(authMiddleware);

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
router.post('/tryon/session', createTryOnSession);

module.exports = router;
