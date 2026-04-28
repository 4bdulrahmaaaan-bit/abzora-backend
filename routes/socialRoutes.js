const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createPost,
  getFeed,
  getInfluencerLook,
  getSharedLook,
  getTrendingLooks,
  shareLook,
  togglePostLike,
  voteSharedLook,
} = require('../controllers/socialController');

const router = express.Router();

router.post('/look/share', authMiddleware, shareLook);
router.get('/look/:id', getSharedLook);
router.post('/look/:id/vote', authMiddleware, voteSharedLook);

router.get('/looks/trending', getTrendingLooks);
router.get('/looks/:id', getInfluencerLook);

router.get('/feed', getFeed);
router.post('/post', authMiddleware, createPost);
router.post('/post/:id/like', authMiddleware, togglePostLike);

module.exports = router;
