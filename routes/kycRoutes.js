const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getMyVendorKycRequest,
  submitVendorKycRequest,
  getMyRiderKycRequest,
  submitRiderKycRequest,
  lookupIfsc,
  extractKycFields,
  verifyVendorKyc,
  verifyRiderKyc,
  updateOnboardingStep,
} = require('../controllers/kycController');

const router = express.Router();

router.use(authMiddleware);
router.get('/vendor/me', getMyVendorKycRequest);
router.post('/vendor', submitVendorKycRequest);
router.get('/rider/me', getMyRiderKycRequest);
router.post('/rider', submitRiderKycRequest);
router.get('/ifsc/:code', lookupIfsc);
router.post('/ocr/extract', extractKycFields);
router.post('/vendor/verify', verifyVendorKyc);
router.post('/rider/verify', verifyRiderKyc);
router.post('/step', updateOnboardingStep);

module.exports = router;
