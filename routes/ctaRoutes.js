const express = require('express');

const { getCtaDecision } = require('../controllers/ctaController');

const router = express.Router();

router.get('/:productId', getCtaDecision);

module.exports = router;

