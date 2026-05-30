const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getCmsEntries,
  getCmsEntryBySlug,
  getCmsFaqs,
} = require('../controllers/cmsController');

const router = express.Router();

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authMiddleware(req, res, next);
}

router.get('/', optionalAuth, getCmsEntries);
router.get('/faqs', optionalAuth, getCmsFaqs);
router.get('/:type/:slug', optionalAuth, getCmsEntryBySlug);

module.exports = router;
