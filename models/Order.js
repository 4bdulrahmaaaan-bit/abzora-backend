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
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Order', orderSchema);
