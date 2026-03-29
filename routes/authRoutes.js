const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { me, debugAuth, upsertTestUser, syncProfile } = require('../controllers/authController');

const router = express.Router();

router.post('/test-user', upsertTestUser);
router.get('/me', authMiddleware, me);
router.get('/debug', authMiddleware, debugAuth);
router.post('/sync-profile', authMiddleware, syncProfile);

module.exports = router;
