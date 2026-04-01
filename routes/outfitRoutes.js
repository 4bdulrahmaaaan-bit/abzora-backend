const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getOutfits,
  trackOutfit,
  getCompleteLook,
} = require('../controllers/outfitController');

const router = express.Router();

router.get('/', getOutfits);
router.get('/complete-look/:productId', getCompleteLook);
router.post('/track', authMiddleware, trackOutfit);

module.exports = router;
