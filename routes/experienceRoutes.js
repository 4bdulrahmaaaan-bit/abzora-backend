const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const {
  fetchExperienceConfig,
  fetchExperienceControl,
  saveExperienceControl,
} = require('../controllers/experienceController');

const router = express.Router();

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authMiddleware(req, res, next);
}

router.get('/controls/current', authMiddleware, requireAdmin, fetchExperienceControl);
router.put('/controls/current', authMiddleware, requireAdmin, saveExperienceControl);
router.get('/:productId', optionalAuth, fetchExperienceConfig);

module.exports = router;
