const mongoose = require('mongoose');

const trackingLogSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: ['location_update', 'order_status_update', 'task_status_update', 'eta_update'],
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    taskId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    riderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    vendorId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0], // [lng, lat]
      },
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    eventAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'tracking_logs',
  },
);

trackingLogSchema.index({ coordinates: '2dsphere' });
trackingLogSchema.index({ orderId: 1, eventAt: -1 });

module.exports = mongoose.model('TrackingLog', trackingLogSchema);
