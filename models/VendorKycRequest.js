const mongoose = require('mongoose');

const kycActionEntrySchema = new mongoose.Schema(
  {
    actorId: { type: String, trim: true, default: '' },
    actorName: { type: String, trim: true, default: '' },
    action: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    timestamp: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const kycDocumentsSchema = new mongoose.Schema(
  {
    ownerPhotoUrl: { type: String, trim: true, default: '' },
    storeImageUrl: { type: String, trim: true, default: '' },
    profilePhotoUrl: { type: String, trim: true, default: '' },
    aadhaarUrl: { type: String, trim: true, default: '' },
    panUrl: { type: String, trim: true, default: '' },
    selfieUrl: { type: String, trim: true, default: '' },
    licenseUrl: { type: String, trim: true, default: '' },
    additionalUrls: { type: [String], default: [] },
  },
  { _id: false }
);

const kycVerificationSummarySchema = new mongoose.Schema(
  {
    provider: { type: String, trim: true, default: '' },
    confidenceScore: { type: Number, default: 0 },
    aadhaarValid: { type: Boolean, default: false },
    panValid: { type: Boolean, default: false },
    duplicateDetected: { type: Boolean, default: false },
    duplicateMatches: { type: [String], default: [] },
    livenessPassed: { type: Boolean, default: false },
    faceVerified: { type: Boolean, default: false },
    matchScore: { type: Number, default: 0 },
    livenessMode: { type: String, trim: true, default: '' },
    selfieRetryCount: { type: Number, default: 0 },
    selfieVerifiedAt: { type: String, trim: true, default: '' },
    flags: { type: [String], default: [] },
    summary: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const vendorKycRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    storeName: { type: String, trim: true, default: '' },
    ownerName: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    kyc: { type: kycDocumentsSchema, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['applied', 'ocr_review', 'business_review', 'finance_review', 'approved', 'active', 'rejected', 'suspended'],
      default: 'applied',
      index: true,
    },
    monthlyCapacity: { type: Number, default: 0 },
    payoutDetails: {
      bankAccount: { type: String, trim: true, default: '' },
      ifsc: { type: String, trim: true, default: '' },
      upiId: { type: String, trim: true, default: '' },
    },
    rejectionReason: { type: String, trim: true, default: '' },
    reviewedBy: { type: String, trim: true, default: '' },
    reviewedByName: { type: String, trim: true, default: '' },
    reviewedAt: { type: String, trim: true, default: '' },
    actionHistory: { type: [kycActionEntrySchema], default: [] },
    verification: { type: kycVerificationSummarySchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VendorKycRequest', vendorKycRequestSchema);
