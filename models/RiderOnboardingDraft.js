const mongoose = require('mongoose');

const riderOnboardingDraftSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    currentStep: { type: Number, default: 0 },
    version: { type: Number, default: 1 },
    draftStatus: {
      type: String,
      enum: ['draft', 'submitted', 'abandoned', 'migrated'],
      default: 'draft',
      index: true,
    },
    startedAt: { type: Date, default: Date.now },
    lastOpenedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    lastSavedAt: { type: Date, default: Date.now },
    
    personal: {
      phone: { type: String, trim: true, default: '' },
      fullName: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      dob: { type: Date, default: null },
      gender: { type: String, trim: true, default: 'Male' },
      city: { type: String, trim: true, default: '' },
      profilePhotoUrl: { type: String, trim: true, default: null },
    },
    
    vehicle: {
      vehicleType: { type: String, trim: true, default: 'bike' },
      vehicleNumber: { type: String, trim: true, default: '' },
      rcUrl: { type: String, trim: true, default: null },
      insuranceUrl: { type: String, trim: true, default: null },
    },
    
    kyc: {
      aadhaarNumber: { type: String, trim: true, default: '' },
      panNumber: { type: String, trim: true, default: '' },
      licenseNumber: { type: String, trim: true, default: '' },
      aadhaarUrl: { type: String, trim: true, default: null },
      panUrl: { type: String, trim: true, default: null },
      licenseDocUrl: { type: String, trim: true, default: null },
      selfieUrl: { type: String, trim: true, default: null },
      kycConfidence: { type: Number, default: 0 },
      kycProcessed: { type: Boolean, default: false },
    },
    
    ocr: {
      aadhaarOcr: { type: mongoose.Schema.Types.Mixed, default: {} },
      panOcr: { type: mongoose.Schema.Types.Mixed, default: {} },
      licenseOcr: { type: mongoose.Schema.Types.Mixed, default: {} },
      verification: { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    finance: {
      accountHolder: { type: String, trim: true, default: '' },
      bankName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      ifsc: { type: String, trim: true, default: '' },
      upi: { type: String, trim: true, default: '' },
    },

    preferences: {
      referral: { type: String, trim: true, default: '' },
      workType: { type: String, trim: true, default: 'fullTime' },
      shift: { type: String, trim: true, default: 'Morning' },
      zoneLat: { type: Number, default: null },
      zoneLng: { type: Number, default: null },
      zoneRadiusKm: { type: Number, default: 5 },
    },

    policies: {
      acceptedTerms: { type: Boolean, default: false },
      signature: { type: String, trim: true, default: '' },
    }
  },
  { timestamps: true }
);

riderOnboardingDraftSchema.index({ updatedAt: 1 });

module.exports = mongoose.model('RiderOnboardingDraft', riderOnboardingDraftSchema);
