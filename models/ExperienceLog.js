const mongoose = require('mongoose');

const experienceLogSchema = new mongoose.Schema(
  {
    decisionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    productId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    sessionId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    cta: {
      type: String,
      enum: ['BUY_NOW', 'TRY_HOME', 'HYBRID'],
      required: true,
      index: true,
    },
    urgency: {
      type: String,
      enum: ['NONE', 'SOFT', 'HIGH'],
      required: true,
      index: true,
    },
    checkoutMode: {
      type: String,
      enum: ['INSTANT', 'STANDARD'],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['RULE', 'AB_TEST', 'ML_BANDIT', 'FALLBACK'],
      default: 'RULE',
      index: true,
    },
    features: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    abAssignments: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    mlDecision: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    result: {
      purchased: { type: Boolean, default: false },
      trialRequested: { type: Boolean, default: false },
      trialConverted: { type: Boolean, default: false },
      reward: { type: Number, default: 0 },
      returnObserved: { type: Boolean, default: false },
    },
    decisionAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true, collection: 'experience_logs' },
);

experienceLogSchema.index({ userId: 1, productId: 1, decisionAt: -1 });

module.exports = mongoose.model('ExperienceLog', experienceLogSchema);
