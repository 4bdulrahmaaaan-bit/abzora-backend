const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
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
router.post('/', authMiddleware, createBanner);
router.put('/:id', authMiddleware, updateBanner);
router.delete('/:id', authMiddleware, deleteBanner);

module.exports = router;
