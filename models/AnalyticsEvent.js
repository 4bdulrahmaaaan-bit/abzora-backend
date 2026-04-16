const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    userId: {
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
    productId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    decisionId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    cta: {
      type: String,
      enum: ['', 'BUY_NOW', 'TRY_HOME', 'HYBRID'],
      default: '',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true, collection: 'analytics_events' },
);

analyticsEventSchema.index({ userId: 1, productId: 1, timestamp: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
