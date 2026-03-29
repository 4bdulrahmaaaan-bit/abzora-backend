const mongoose = require('mongoose');

const savedCardSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
    },
    last4: {
      type: String,
      required: true,
      trim: true,
    },
    cardType: {
      type: String,
      required: true,
      trim: true,
      default: 'Card',
    },
    gatewayCustomerId: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

savedCardSchema.index({ userId: 1, token: 1 }, { unique: true });

module.exports = mongoose.model('SavedCard', savedCardSchema);
