const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { getRiderWallet, requestRiderWithdraw } = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/wallet', getRiderWallet);
router.post('/withdraw', requestRiderWithdraw);

module.exports = router;
