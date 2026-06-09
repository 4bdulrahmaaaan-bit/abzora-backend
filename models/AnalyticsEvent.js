const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      trim: true,
      enum: [
        'product_view',
        'product_click',
        'wishlist_add',
        'cart_add',
        'checkout_start',
        'purchase',
        'review_submit',
        'coupon_apply',
        'campaign_click',
        'search'
      ],
      index: true,
    },
    vendorId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      index: true,
    },
    productId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    customerId: {
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
    isTrialOrder: {
      type: Boolean,
      default: false,
    },
    trialSessionId: {
      type: String,
      default: '',
      trim: true,
    },
    trialOutcome: {
      type: String,
      enum: ['', 'converted', 'returned', 'partial_purchase', 'cancelled', 'damaged'],
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true, collection: 'analytics_events' }
);

analyticsEventSchema.index({ customerId: 1, productId: 1, createdAt: -1 });
analyticsEventSchema.index({ storeId: 1, eventType: 1, createdAt: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
