const express = require('express');

const { getMlDecision, postMlReward } = require('../controllers/mlController');

const router = express.Router();

router.get('/decision', getMlDecision);
router.post('/reward', postMlReward);

module.exports = router;
