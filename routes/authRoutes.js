const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { otpLimiter } = require('../middleware/rateLimiter');
const { requireRoles } = require('../middleware/authorizationMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  couponValidateSchema,
  growthOfferClaimSchema,
  growthOfferValidateSchema,
  referralApplySchema,
} = require('../validation/schemas/customerSchemas');
const {
  createAuthSession,
  refreshAuthSession,
  logoutAuthSession,
  me,
  getUserByIdentifier,
  debugAuth,
  upsertTestUser,
  syncProfile,
  switchActiveRole,
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
  listCoupons,
  listCouponCatalog,
  validateCoupon,
  listGrowthOffers,
  saveGrowthOffer,
  validateGrowthOffer,
  claimGrowthOffer,
} = require('../controllers/authController');

module.exports = (authLoginLimiter, authOperationalLimiter) => {
  const router = express.Router();

  router.post('/test-user', authLoginLimiter, upsertTestUser);
  router.post('/session', authLoginLimiter, createAuthSession);
  router.post('/session/refresh', authOperationalLimiter, refreshAuthSession);
  router.post('/session/logout', authOperationalLimiter, logoutAuthSession);
  router.get('/me', authOperationalLimiter, authMiddleware, me);
  router.get('/profile', authOperationalLimiter, authMiddleware, me);
router.get('/users/:id', authMiddleware, requireRoles('vendor', 'rider', 'admin', 'super_admin'), getUserByIdentifier);
router.get('/debug', authMiddleware, debugAuth);
router.post('/sync-profile', authMiddleware, syncProfile);
router.patch('/me/role', authOperationalLimiter, authMiddleware, switchActiveRole);
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
router.post('/referrals/apply', authMiddleware, validateBody(referralApplySchema), applyReferralCode);
router.get('/referrals/history', authMiddleware, listReferralHistory);
router.get('/referrals/dashboard', authMiddleware, getReferralDashboard);
router.get('/coupons', authMiddleware, listCoupons);
router.get('/coupons/catalog', authMiddleware, listCouponCatalog);
router.post('/coupons/validate', authMiddleware, validateBody(couponValidateSchema), validateCoupon);
router.get('/growth-offers', authMiddleware, listGrowthOffers);
router.post('/growth-offers', authMiddleware, saveGrowthOffer);
router.post('/growth-offers/validate', authMiddleware, validateBody(growthOfferValidateSchema), validateGrowthOffer);
router.post('/growth-offers/claim', authMiddleware, validateBody(growthOfferClaimSchema), claimGrowthOffer);
  return router;
};
