const mongoose = require('mongoose');

const deliveryTaskSchema = new mongoose.Schema(
  {
    taskType: {
      type: String,
      enum: ['ORDER_DELIVERY', 'TRIAL_DELIVERY', 'TRIAL_PICKUP'],
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['order', 'trial_session'],
      required: true,
      index: true,
    },
    entityId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    orderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    trialSessionId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    storeId: {
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
    userId: {
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
    status: {
      type: String,
      enum: ['assigned', 'accepted', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled'],
      default: 'assigned',
      index: true,
    },
    sameDay: {
      type: Boolean,
      default: false,
      index: true,
    },
    scheduledAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    pickupAddress: {
      type: String,
      default: '',
      trim: true,
    },
    dropAddress: {
      type: String,
      default: '',
      trim: true,
    },
    pickupLat: {
      type: Number,
      default: null,
    },
    pickupLng: {
      type: Number,
      default: null,
    },
    dropLat: {
      type: Number,
      default: null,
    },
    dropLng: {
      type: Number,
      default: null,
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    routeDistanceKm: {
      type: Number,
      default: 0,
      min: 0,
    },
    routeDurationMins: {
      type: Number,
      default: 0,
      min: 0,
    },
    workloadAtAssignment: {
      type: Number,
      default: 0,
      min: 0,
    },
    otpCode: {
      type: String,
      default: '',
      trim: true,
    },
    proofPhotoUrl: {
      type: String,
      default: '',
      trim: true,
    },
    proofNote: {
      type: String,
      default: '',
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'deliveries',
  },
);

deliveryTaskSchema.index({ riderId: 1, status: 1, createdAt: -1 });
deliveryTaskSchema.index({ userId: 1, createdAt: -1 });
deliveryTaskSchema.index({ storeId: 1, createdAt: -1 });
deliveryTaskSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('DeliveryTask', deliveryTaskSchema);
