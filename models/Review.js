const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    vendorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    customerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
      trim: true,
      default: '',
    },
    images: {
      type: [String],
      default: () => [],
    },
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },
    helpfulCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    reportedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isTrialOrder: {
      type: Boolean,
      default: false,
    },
    trialSessionId: {
      type: String,
      trim: true,
      default: '',
    },
    trialOutcome: {
      type: String,
      enum: ['', 'converted', 'returned', 'partial_purchase', 'cancelled', 'damaged'],
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'product_reviews',
  }
);

reviewSchema.index({ customerId: 1, productId: 1, orderId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
