const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
} = require('../controllers/bannerController');

const router = express.Router();

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authMiddleware(req, res, next);
}

router.get('/', optionalAuth, listBanners);
router.post('/', authMiddleware, requireAdmin, createBanner);
router.put('/:id', authMiddleware, requireAdmin, updateBanner);
router.delete('/:id', authMiddleware, requireAdmin, deleteBanner);

module.exports = router;
