const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  deleteReview,
  listProductReviews,
  listStoreReviews,
  saveReview,
} = require('../controllers/reviewController');

const router = express.Router();

router.get('/products/:productId', listProductReviews);
router.get('/stores/:storeId', listStoreReviews);
router.post('/', authMiddleware, saveReview);
router.delete('/:id', authMiddleware, deleteReview);

module.exports = router;
