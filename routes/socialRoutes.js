const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  emptyBodySchema,
  socialCreatePostSchema,
  socialFeedQuerySchema,
  socialShareLookSchema,
  socialVoteSchema,
} = require('../validation/schemas/customerSchemas');
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

router.post('/look/share', authMiddleware, validateBody(socialShareLookSchema), shareLook);
router.get('/look/:id', getSharedLook);
router.post('/look/:id/vote', authMiddleware, validateBody(socialVoteSchema), voteSharedLook);

router.get('/looks/trending', validateQuery(socialFeedQuerySchema), getTrendingLooks);
router.get('/looks/:id', getInfluencerLook);

router.get('/feed', validateQuery(socialFeedQuerySchema), getFeed);
router.post('/post', authMiddleware, validateBody(socialCreatePostSchema), createPost);
router.post('/post/:id/like', authMiddleware, validateBody(emptyBodySchema), togglePostLike);

module.exports = router;
