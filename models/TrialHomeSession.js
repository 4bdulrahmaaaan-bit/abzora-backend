const mongoose = require('mongoose');

const trialHomeItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    recommendedSize: {
      type: String,
      default: '',
      trim: true,
    },
    fitConfidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    styledForYou: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      default: 'selected',
      trim: true,
    },
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    fit: {
      type: String,
      enum: ['perfect', 'too_tight', 'too_loose', 'not_shared'],
      default: 'not_shared',
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    tailoringRecommendation: {
      type: String,
      default: '',
      trim: true,
    },
    adjustmentOptions: {
      type: [String],
      default: [],
    },
    submittedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
    },
    actorId: {
      type: String,
      default: '',
      trim: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const trialHomeSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    orderId: {
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
    riderId: {
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
    status: {
      type: String,
      enum: [
        'draft',
        'booked',
        'confirmed',
        'assigned',
        'en_route',
        'arrived',
        'trial_started',
        'trial_active',
        'out_for_trial_delivery',
        'trial_in_progress',
        'completed',
        'converted_to_order',
        'converted_to_tailoring',
        'cancelled',
        'no_show',
      ],
      default: 'booked',
      index: true,
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    approvedBy: {
      type: String,
      enum: ['', 'vendor', 'admin', 'system'],
      default: '',
      trim: true,
    },
    approvalReason: {
      type: String,
      default: '',
      trim: true,
    },
    items: {
      type: [trialHomeItemSchema],
      default: [],
      validate: {
        validator(items) {
          return Array.isArray(items) && items.length > 0 && items.length <= 5;
        },
        message: 'Trial home sessions must contain between 1 and 5 items.',
      },
    },
    recommendedItems: {
      type: [trialHomeItemSchema],
      default: [],
    },
    addressLabel: {
      type: String,
      required: true,
      trim: true,
    },
    deliverySlot: {
      type: String,
      required: true,
      trim: true,
    },
    deliveryWindowLabel: {
      type: String,
      default: 'Delivered in 24 hours',
      trim: true,
    },
    scheduledAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    trialDurationMinutes: { type: Number, default: 15, min: 1 },
    itemsDelivered: { type: Number, default: 0, min: 0 },
    experienceType: {
      type: String,
      enum: ['standard', 'premium'],
      default: 'premium',
    },
    trialFee: {
      type: Number,
      default: 99,
      min: 0,
    },
    trialFeeRefundable: {
      type: Boolean,
      default: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'authorized', 'captured', 'held', 'failed', 'refunded', 'waived'],
      default: 'pending',
    },
    paymentCollected: { type: Boolean, default: false },
    paymentMethod: { type: String, default: '' },
    paymentAmount: { type: Number, default: 0, min: 0 },
    paymentCollectedAt: { type: Date, default: null },
    razorpayOrderId: { type: String, default: '', trim: true },
    razorpayPaymentId: { type: String, default: '', trim: true },
    transactionReference: { type: String, default: '', trim: true },
    finalAmount: { type: Number, default: 0, min: 0 },
    trialOutcome: {
      type: String,
      enum: ['converted', 'returned', 'partial_purchase', 'cancelled', 'damaged', ''],
      default: '',
    },
    notes: { type: String, default: '', trim: true },
    proofPhotos: { type: [String], default: [] },
    customerAcknowledged: { type: Boolean, default: false },
    customerAcknowledgedAt: { type: Date, default: null },
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    keptItems: {
      type: [String],
      default: [],
    },
    returnedItems: {
      type: [String],
      default: [],
    },
    convertedOrderId: {
      type: String,
      default: '',
      trim: true,
    },
    converted: {
      type: Boolean,
      default: false,
      index: true,
    },
    returnObserved: {
      type: Boolean,
      default: false,
      index: true,
    },
    tailoringRequest: {
      type: String,
      default: '',
      trim: true,
    },
    feedback: {
      type: feedbackSchema,
      default: () => ({}),
    },
    events: {
      type: [eventSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

trialHomeSessionSchema.index({ riderId: 1, status: 1 });
trialHomeSessionSchema.index({ userId: 1, status: 1 });
trialHomeSessionSchema.index({ vendorId: 1, status: 1 });
trialHomeSessionSchema.index({ paymentStatus: 1 });
trialHomeSessionSchema.index({ startedAt: 1 });
trialHomeSessionSchema.index({ completedAt: 1 });

module.exports = mongoose.model('TrialHomeSession', trialHomeSessionSchema);
