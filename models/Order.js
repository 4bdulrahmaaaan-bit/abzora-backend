const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    size: {
      type: String,
      trim: true,
      default: '',
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    addressLine1: { type: String, trim: true, default: '' },
    addressLine2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    pincode: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const razorpaySchema = new mongoose.Schema(
  {
    orderId: { type: String, trim: true, default: '' },
    paymentId: { type: String, trim: true, default: '' },
    signature: { type: String, trim: true, default: '' },
    receipt: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const trackingTimestampSchema = new mongoose.Schema({}, { _id: false, strict: false });
const customMeasurementsSchema = new mongoose.Schema({}, { _id: false, strict: false });
const customDesignSchema = new mongoose.Schema({}, { _id: false, strict: false });
const pricingBreakdownSchema = new mongoose.Schema({}, { _id: false, strict: false });
const atelierOptionsSchema = new mongoose.Schema({}, { _id: false, strict: false });

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: 'Order must have at least one item.',
      },
    },
    subtotalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    productAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryDistanceKm: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
    },
    tryAtHomeFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    tryAtHomeFeeRefundable: {
      type: Boolean,
      default: false,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    orderType: {
      type: String,
      enum: ['standard', 'trial_conversion'],
      default: 'standard',
      index: true,
    },
    sameDayOrder: {
      type: Boolean,
      default: false,
      index: true,
    },
    experienceDecisionId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    platformCommission: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 0.3,
    },
    vendorEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    riderEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentGatewayFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    platformRevenue: {
      type: Number,
      default: 0,
    },
    platformCost: {
      type: Number,
      default: 0,
    },
    platformProfit: {
      type: Number,
      default: 0,
    },
    pricingBreakdown: {
      type: pricingBreakdownSchema,
      default: () => ({}),
    },
    paymentMethod: {
      type: String,
      enum: ['RAZORPAY', 'COD'],
      default: 'RAZORPAY',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    escrowStatus: {
      type: String,
      enum: ['held', 'released', 'refunded'],
      default: 'held',
    },
    escrowReleasedAt: {
      type: String,
      trim: true,
      default: '',
    },
    escrowUpdatedAt: {
      type: String,
      trim: true,
      default: '',
    },
    payoutStatus: {
      type: String,
      enum: ['none', 'pending', 'processed', 'reversed'],
      default: 'none',
    },
    fulfillmentType: {
      type: String,
      enum: ['marketplace', 'custom_tailoring'],
      default: 'marketplace',
      index: true,
    },
    customOrderStatus: {
      type: String,
      enum: [
        'none',
        'new_order',
        'accepted',
        'draft',
        'confirmed',
        'measuring',
        'stitching',
        'needs_clarification',
        'in_stitching',
        'quality_check',
        'ready',
        'pickup',
        'shipped',
        'delivered',
        'rejected',
      ],
      default: 'none',
      index: true,
    },
    selectedDesignerName: {
      type: String,
      trim: true,
      default: '',
    },
    customMeasurements: {
      type: customMeasurementsSchema,
      default: () => ({}),
    },
    atelierCustomization: {
      type: atelierOptionsSchema,
      default: () => ({}),
    },
    measurementMethod: {
      type: String,
      enum: ['', 'standard', 'manual', 'trial', 'visit'],
      default: '',
    },
    atelierStatus: {
      type: String,
      enum: ['none', 'draft', 'confirmed', 'measuring', 'stitching', 'ready', 'pickup', 'delivered', 'cancelled', 'rejected'],
      default: 'none',
      index: true,
    },
    atelierTailoringCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    atelierCustomizationCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    atelierHomeVisitCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    customDesignOptions: {
      type: customDesignSchema,
      default: () => ({}),
    },
    referenceImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    previewImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    vendorFinalImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    qualityApprovalStatus: {
      type: String,
      enum: ['not_required', 'pending', 'approved', 'rejected'],
      default: 'not_required',
    },
    measurementsConfirmedByVendor: {
      type: Boolean,
      default: false,
    },
    preDispatchChecklistCompletedAt: {
      type: String,
      trim: true,
      default: '',
    },
    customerFitFeedbackStatus: {
      type: String,
      enum: ['pending', 'fit_good', 'alteration_requested', 'issue_reported'],
      default: 'pending',
    },
    customerFitRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    customerQualityRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    customerDeliveryRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    customerFitFeedbackNotes: {
      type: String,
      trim: true,
      default: '',
    },
    customerFitRespondedAt: {
      type: String,
      trim: true,
      default: '',
    },
    alterationStatus: {
      type: String,
      enum: ['none', 'requested', 'accepted', 'in_progress', 'completed', 'rejected'],
      default: 'none',
    },
    alterationRequestedAt: {
      type: String,
      trim: true,
      default: '',
    },
    alterationResolvedAt: {
      type: String,
      trim: true,
      default: '',
    },
    alterationNotes: {
      type: String,
      trim: true,
      default: '',
    },
    customProductionTimeDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    customizationSummary: {
      type: String,
      trim: true,
      default: '',
    },
    riderPayoutStatus: {
      type: String,
      enum: ['none', 'pending', 'processed', 'reversed'],
      default: 'none',
    },
    payoutId: {
      type: String,
      trim: true,
      default: '',
    },
    riderPayoutId: {
      type: String,
      trim: true,
      default: '',
    },
    payoutProcessed: {
      type: Boolean,
      default: false,
    },
    vendorCredited: {
      type: Boolean,
      default: false,
    },
    riderCredited: {
      type: Boolean,
      default: false,
    },
    commissionRecorded: {
      type: Boolean,
      default: false,
    },
    financialReversed: {
      type: Boolean,
      default: false,
    },
    settlementFailureCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastSettlementError: {
      type: String,
      trim: true,
      default: '',
    },
    isSuspicious: {
      type: Boolean,
      default: false,
      index: true,
    },
    fraudStatus: {
      type: String,
      enum: ['clear', 'review', 'blocked'],
      default: 'clear',
      index: true,
    },
    riskScore: {
      type: Number,
      default: 0,
    },
    riskReasons: {
      type: [String],
      default: [],
    },
    fraudSignals: {
      type: [String],
      default: [],
    },
    placedFromIp: {
      type: String,
      trim: true,
      default: '',
    },
    placedFromDeviceId: {
      type: String,
      trim: true,
      default: '',
    },
    refundStatus: {
      type: String,
      enum: ['none', 'requested', 'pending', 'approved', 'refunded', 'rejected'],
      default: 'none',
    },
    returnStatus: {
      type: String,
      enum: ['none', 'requested', 'approved', 'assigned', 'picked', 'completed', 'rejected'],
      default: 'none',
    },
    refundRequestId: {
      type: String,
      trim: true,
      default: '',
    },
    returnRequestId: {
      type: String,
      trim: true,
      default: '',
    },
    orderStatus: {
      type: String,
      enum: ['pending', 'created', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    inventoryDeducted: {
      type: Boolean,
      default: false,
    },
    riderId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: ['Pending', 'Ready for pickup', 'Assigned', 'Picked up', 'Out for delivery', 'Delivered', 'Cancelled'],
      default: 'Pending',
    },
    assignedDeliveryPartner: {
      type: String,
      trim: true,
      default: 'Unassigned',
    },
    trackingId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    trackingTimestamps: {
      type: trackingTimestampSchema,
      default: () => ({}),
    },
    riderLatitude: {
      type: Number,
      default: null,
    },
    riderLongitude: {
      type: Number,
      default: null,
    },
    riderLocationUpdatedAt: {
      type: String,
      trim: true,
      default: '',
    },
    shippingAddress: {
      type: shippingAddressSchema,
      default: () => ({}),
    },
    razorpay: {
      type: razorpaySchema,
      default: () => ({}),
    },
    isTrialOrder: {
      type: Boolean,
      default: false,
      index: true,
    },
    trialSessionId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    trialOutcome: {
      type: String,
      enum: ['', 'converted', 'returned', 'partial_purchase', 'cancelled', 'damaged'],
      default: '',
    },
    trialCompletedAt: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
orderSchema.index({ riderId: 1, status: 1 });
orderSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
