const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getOutfits,
  trackOutfit,
  getCompleteLook,
  getBodyTypeRecommendations,
} = require('../controllers/outfitController');

const router = express.Router();

router.get('/', getOutfits);
router.get('/complete-look/:productId', getCompleteLook);
router.get('/body-type', authMiddleware, getBodyTypeRecommendations);
router.post('/track', authMiddleware, trackOutfit);

module.exports = router;
