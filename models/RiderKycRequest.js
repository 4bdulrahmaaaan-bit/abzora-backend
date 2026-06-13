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

const riderKycRequestSchema = new mongoose.Schema(
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
    name: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    vehicle: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    kyc: { type: kycDocumentsSchema, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['applied', 'kyc_review', 'verification_review', 'training_pending', 'fleet_approval', 'active', 'rejected', 'suspended'],
      default: 'applied',
      index: true,
    },
    training: {
      status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
      quizScore: { type: Number, default: 0 },
      completedAt: { type: Date }
    },
    rejectionReason: { type: String, trim: true, default: '' },
    reviewedBy: { type: String, trim: true, default: '' },
    reviewedByName: { type: String, trim: true, default: '' },
    reviewedAt: { type: String, trim: true, default: '' },
    actionHistory: { type: [kycActionEntrySchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RiderKycRequest', riderKycRequestSchema);
