const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { getMlDecision, postMlReward } = require('../controllers/mlController');

const router = express.Router();

router.get('/decision', getMlDecision);
router.post('/reward', authMiddleware, postMlReward);

module.exports = router;
