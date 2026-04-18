const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema(
  {
    defaultCommissionReadyMade: { type: Number, default: 0.18, min: 0.15, max: 0.2 },
    defaultCommissionCustom: { type: Number, default: 0.24, min: 0.2, max: 0.3 },
    highPerformerAdjustment: { type: Number, default: -0.03, min: -0.05, max: 0 },
    lowSlaAdjustment: { type: Number, default: 0.05, min: 0, max: 0.05 },
    perVendorOverrides: { type: Map, of: Number, default: {} },
  },
  { _id: false },
);

const deliverySchema = new mongoose.Schema(
  {
    minDeliveryFee: { type: Number, default: 39, min: 0 },
    slabUpTo2Km: { type: Number, default: 49, min: 0 },
    slab2To5Km: { type: Number, default: 69, min: 0 },
    slabAbove5Km: { type: Number, default: 79, min: 0 },
    surgeEnabled: { type: Boolean, default: true },
    surgeMultiplier: { type: Number, default: 1.15, min: 1, max: 1.5 },
    peakHourAdjustment: { type: Number, default: 10, min: 0, max: 100 },
  },
  { _id: false },
);

const trialSchema = new mongoose.Schema(
  {
    trialFee: { type: Number, default: 99, min: 0 },
    refundable: { type: Boolean, default: true },
    waiveOnPurchase: { type: Boolean, default: true },
  },
  { _id: false },
);

const discountSchema = new mongoose.Schema(
  {
    discountsEnabled: { type: Boolean, default: true },
    firstOrderDiscount: { type: Number, default: 100, min: 0 },
    maxDiscountPercent: { type: Number, default: 0.1, min: 0.1, max: 0.15 },
    maxDiscountCap: { type: Number, default: 300, min: 0 },
    disableAfterOrders: { type: Number, default: 3, min: 0, max: 50 },
    targetUserIds: { type: [String], default: [] },
    targetVendorIds: { type: [String], default: [] },
  },
  { _id: false },
);

const riderPayoutSchema = new mongoose.Schema(
  {
    basePayout: { type: Number, default: 30, min: 30 },
    distanceBonusNear: { type: Number, default: 10, min: 0 },
    distanceBonusMid: { type: Number, default: 15, min: 0 },
    distanceBonusFar: { type: Number, default: 20, min: 0 },
    peakBonus: { type: Number, default: 10, min: 0 },
    trialPayoutBase: { type: Number, default: 60, min: 60 },
    trialPayoutMax: { type: Number, default: 80, min: 60 },
    latePenaltyMild: { type: Number, default: 10, min: 0 },
    latePenaltyHigh: { type: Number, default: 20, min: 0 },
    minPayout: { type: Number, default: 30, min: 30 },
  },
  { _id: false },
);

const dynamicRulesSchema = new mongoose.Schema(
  {
    highDemandLowRidersEnabled: { type: Boolean, default: true },
    lowConversionBoostEnabled: { type: Boolean, default: true },
    highReturnPromoteTrialEnabled: { type: Boolean, default: true },
    highDemandThreshold: { type: Number, default: 75, min: 0, max: 100 },
    lowRiderThreshold: { type: Number, default: 3, min: 0, max: 1000 },
    lowConversionThreshold: { type: Number, default: 0.12, min: 0, max: 1 },
    highReturnThreshold: { type: Number, default: 0.3, min: 0, max: 1 },
  },
  { _id: false },
);

const pricingConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'global-pricing',
      trim: true,
    },
    commission: { type: commissionSchema, default: () => ({}) },
    deliveryFees: { type: deliverySchema, default: () => ({}) },
    trialPricing: { type: trialSchema, default: () => ({}) },
    discounts: { type: discountSchema, default: () => ({}) },
    riderPayouts: { type: riderPayoutSchema, default: () => ({}) },
    dynamicRules: { type: dynamicRulesSchema, default: () => ({}) },
    updatedBy: { type: String, default: '', trim: true },
    updateSource: { type: String, default: 'system', trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PricingConfig', pricingConfigSchema);
