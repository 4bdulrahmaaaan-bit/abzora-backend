const mongoose = require('mongoose');

const vendorOnboardingDraftSchema = new mongoose.Schema(
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
    
    business: {
      storeName: { type: String, trim: true, default: '' },
      businessType: { type: String, trim: true, default: 'Individual Seller' },
      gstNumber: { type: String, trim: true, default: '' },
      address: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: 'Chennai' },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    
    expertise: {
      experienceYears: { type: String, trim: true, default: '' },
      specializations: { type: [String], default: [] },
      serviceTypes: { type: [String], default: [] },
      tags: { type: [String], default: [] },
    },
    
    portfolio: {
      portfolioImages: { type: [String], default: [] },
      coverImage: { type: Number, default: 0 }, // Represents primaryPortfolioIndex
    },
    
    finance: {
      startingPrice: { type: String, trim: true, default: '' },
      upperRange: { type: String, trim: true, default: '' },
      productionDays: { type: String, trim: true, default: '7' },
      monthlyCapacity: { type: String, trim: true, default: '' },
      bankAccount: { type: String, trim: true, default: '' },
      ifscCode: { type: String, trim: true, default: '' },
      upiId: { type: String, trim: true, default: '' },
      settlementPreference: { type: String, trim: true, default: 'Weekly' },
      preferredPaymentMethod: { type: String, trim: true, default: 'Bank Transfer' },
    },
    
    kyc: {
      ownerPhotoUrl: { type: String, trim: true, default: null },
      storePhotoUrl: { type: String, trim: true, default: null },
      aadhaarUrl: { type: String, trim: true, default: null },
      panUrl: { type: String, trim: true, default: null },
      kycConfidence: { type: Number, default: 0 },
      kycProcessed: { type: Boolean, default: false },
    },
    
    ocr: {
      aadhaarOcr: { type: mongoose.Schema.Types.Mixed, default: {} },
      panOcr: { type: mongoose.Schema.Types.Mixed, default: {} },
      verification: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  { timestamps: true }
);

vendorOnboardingDraftSchema.index({ updatedAt: 1 });

module.exports = mongoose.model('VendorOnboardingDraft', vendorOnboardingDraftSchema);
