const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { getVendorWallet, requestVendorWithdraw } = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/wallet', getVendorWallet);
router.post('/withdraw', requestVendorWithdraw);

module.exports = router;
