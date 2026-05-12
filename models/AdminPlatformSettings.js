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
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminPlatformSettings', adminPlatformSettingsSchema);
