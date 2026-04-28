const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  deleteWardrobeOutfit,
  getWardrobe,
  recommendFromUserWardrobe,
  saveOutfit,
  updateWardrobeOutfit,
} = require('../controllers/wardrobeController');

const router = express.Router();

router.use(authMiddleware);
router.post('/save', saveOutfit);
router.get('/', getWardrobe);
router.put('/:id', updateWardrobeOutfit);
router.delete('/:id', deleteWardrobeOutfit);
router.get('/recommend', recommendFromUserWardrobe);

module.exports = router;
