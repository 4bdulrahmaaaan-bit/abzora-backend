const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  fetchExperienceConfig,
  fetchExperienceControl,
  saveExperienceControl,
} = require('../controllers/experienceController');

const router = express.Router();

router.get('/controls/current', fetchExperienceControl);
router.put('/controls/current', authMiddleware, saveExperienceControl);
router.get('/:productId', fetchExperienceConfig);

module.exports = router;
