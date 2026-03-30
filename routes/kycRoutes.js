const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getMyVendorKycRequest,
  submitVendorKycRequest,
  getMyRiderKycRequest,
  submitRiderKycRequest,
} = require('../controllers/kycController');

const router = express.Router();

router.use(authMiddleware);
router.get('/vendor/me', getMyVendorKycRequest);
router.post('/vendor', submitVendorKycRequest);
router.get('/rider/me', getMyRiderKycRequest);
router.post('/rider', submitRiderKycRequest);

module.exports = router;
