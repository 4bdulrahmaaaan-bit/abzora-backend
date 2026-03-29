const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  listWishlist,
  addWishlistItem,
  removeWishlistItem,
} = require('../controllers/wishlistController');

const router = express.Router();

router.use(authMiddleware);
router.get('/', listWishlist);
router.post('/', addWishlistItem);
router.delete('/:productId', removeWishlistItem);

module.exports = router;
