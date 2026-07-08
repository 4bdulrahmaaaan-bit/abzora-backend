const mongoose = require('mongoose');

const adminPlatformSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'platform-settings',
      trim: true,
    },
    customTailoringEnabled: { type: Boolean, default: true },
    reelsEnabled: { type: Boolean, default: true },
    offersEnabled: { type: Boolean, default: true },
    checkoutEnabled: { type: Boolean, default: true },
    marketplaceEnabled: { type: Boolean, default: true },
    riderDispatchEnabled: { type: Boolean, default: true },
    enableLocalRiderDelivery: { type: Boolean, default: false },
    cities: { type: Map, of: Boolean, default: { Mumbai: true, Delhi: true, Bangalore: true, Hyderabad: true } },
    regionVendorAvailability: {
      type: Map,
      of: Boolean,
      default: { Mumbai: true, Delhi: true, Bangalore: true, Hyderabad: true },
    },
    allowedAdminDevices: {
      type: [String],
      default: ['web-chrome', 'windows-desktop'],
    },
    adminIdleTimeoutMinutes: { type: Number, default: 10 },
    adminPinEnabled: { type: Boolean, default: false },
    adminPin: { type: String, default: '', trim: true },
    aiDailyCostAlertThreshold: { type: Number, default: 1.0 },
    aiDailyCostLimit: { type: Number, default: 500 },
    aiAssistantEnabled: { type: Boolean, default: true },
    trialHomeEnabled: { type: Boolean, default: true },
    trialHomeFraudDetectionEnabled: { type: Boolean, default: true },
    trialHomeMinUserScore: { type: Number, default: 45 },
    trialHomeMaxRiskScore: { type: Number, default: 80 },
    legalPolicyVersions: {
      customer: { type: String, default: 'v1.0.0', trim: true },
      vendor: { type: String, default: 'v1.0.0', trim: true },
      rider: { type: String, default: 'v1.0.0', trim: true },
    },
    
    // Marketplace Group
    commissionPercent: { type: Number, default: 15.0 },
    deliveryFee: { type: Number, default: 40.0 },
    returnFee: { type: Number, default: 20.0 },
    serviceFee: { type: Number, default: 10.0 },

    // TBYB Group
    trialFee: { type: Number, default: 50.0 },
    trialDurationHours: { type: Number, default: 24 },
    returnWindowHours: { type: Number, default: 48 },
    purchaseWindowHours: { type: Number, default: 72 },
    maxActiveTrials: { type: Number, default: 3 },

    // Fraud Engine Group
    fraudWarningThreshold: { type: Number, default: 60 },
    fraudCriticalThreshold: { type: Number, default: 85 },
    fraudAlertThreshold: { type: Number, default: 75 },

    // Coupons Group
    couponReferralLimit: { type: Number, default: 5 },
    couponCampaignLimit: { type: Number, default: 1000 },
    couponGlobalLimit: { type: Number, default: 5000 },

    // Notifications Group
    notificationTemplates: { type: Map, of: String, default: {} },
    notificationReminderRules: { type: Map, of: Number, default: { 'abandonedCart': 24, 'trialExpiry': 2 } },
    notificationRetryRules: { type: Number, default: 3 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminPlatformSettings', adminPlatformSettingsSchema);
