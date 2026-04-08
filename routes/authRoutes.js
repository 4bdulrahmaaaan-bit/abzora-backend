const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  me,
  debugAuth,
  upsertTestUser,
  syncProfile,
  listAddresses,
  saveAddress,
  deleteAddress,
  getMemory,
  saveMemory,
  getBodyProfile,
  saveBodyProfile,
  listMeasurementProfiles,
  saveMeasurementProfile,
  removeMeasurementProfile,
  applyReferralCode,
  listReferralHistory,
  getReferralDashboard,
  listGrowthOffers,
  saveGrowthOffer,
  validateGrowthOffer,
  claimGrowthOffer,
} = require('../controllers/authController');

const router = express.Router();

router.post('/test-user', upsertTestUser);
router.get('/me', authMiddleware, me);
router.get('/debug', authMiddleware, debugAuth);
router.post('/sync-profile', authMiddleware, syncProfile);
router.get('/addresses', authMiddleware, listAddresses);
router.post('/addresses', authMiddleware, saveAddress);
router.delete('/addresses/:id', authMiddleware, deleteAddress);
router.get('/memory', authMiddleware, getMemory);
router.put('/memory', authMiddleware, saveMemory);
router.get('/body-profile', authMiddleware, getBodyProfile);
router.post('/body-profile', authMiddleware, saveBodyProfile);
router.get('/measurements', authMiddleware, listMeasurementProfiles);
router.post('/measurements', authMiddleware, saveMeasurementProfile);
router.delete('/measurements/:id', authMiddleware, removeMeasurementProfile);
router.post('/referrals/apply', authMiddleware, applyReferralCode);
router.get('/referrals/history', authMiddleware, listReferralHistory);
router.get('/referrals/dashboard', authMiddleware, getReferralDashboard);
router.get('/growth-offers', authMiddleware, listGrowthOffers);
router.post('/growth-offers', authMiddleware, saveGrowthOffer);
router.post('/growth-offers/validate', authMiddleware, validateGrowthOffer);
router.post('/growth-offers/claim', authMiddleware, claimGrowthOffer);

module.exports = router;
