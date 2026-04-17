const mongoose = require('mongoose');

const dispatchBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    riderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    orderIds: {
      type: [String],
      default: [],
      index: true,
    },
    taskIds: {
      type: [String],
      default: [],
      index: true,
    },
    score: {
      type: Number,
      default: 0,
    },
    estimatedDistanceKm: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimatedDurationMins: {
      type: Number,
      default: 0,
      min: 0,
    },
    sameDayDeadlineAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['created', 'assigned', 'in_progress', 'completed', 'cancelled'],
      default: 'created',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'dispatch_batches',
  },
);

dispatchBatchSchema.index({ riderId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('DispatchBatch', dispatchBatchSchema);
