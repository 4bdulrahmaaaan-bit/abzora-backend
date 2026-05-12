const express = require('express');

const { getLegalVersions } = require('../controllers/legalController');

const router = express.Router();

router.get('/versions', getLegalVersions);

module.exports = router;

