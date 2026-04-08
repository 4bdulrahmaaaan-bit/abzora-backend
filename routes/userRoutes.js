const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { getBodyProfile, saveBodyProfile } = require('../controllers/authController');

const router = express.Router();

router.get('/body-profile', authMiddleware, getBodyProfile);
router.post('/body-profile', authMiddleware, saveBodyProfile);

module.exports = router;
