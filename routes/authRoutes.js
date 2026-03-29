const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { me, debugAuth, syncProfile } = require('../controllers/authController');

const router = express.Router();

router.get('/me', authMiddleware, me);
router.get('/debug', authMiddleware, debugAuth);
router.post('/sync-profile', authMiddleware, syncProfile);

module.exports = router;
