const express = require('express');

const { getHomeVisualConfig } = require('../controllers/homeVisualController');

const router = express.Router();

router.get('/', getHomeVisualConfig);

module.exports = router;
