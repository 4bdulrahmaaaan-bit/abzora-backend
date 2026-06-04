const crypto = require('crypto');

const Razorpay = require('razorpay');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Store = require('../models/Store');
const User = require('../models/User');
const ReferralRecord = require('../models/ReferralRecord');
const RefundRequest = require('../models/RefundRequest');
const ReturnRequest = require('../models/ReturnRequest');
const Transaction = require('../models/Transaction');
const PaymentOutboxEvent = require('../models/PaymentOutboxEvent');
const telemetry = require('../services/telemetryContext');
const { trackOutfitInteraction } = require('../services/outfitEngine');
const { generatePremiumInvoicePdf } = require('../services/invoicePdfService');
const { enqueueInvoiceJob } = require('../services/invoiceService');
const { recordTrackingEvent } = require('../services/trackingEventService');
const { calculateOrderPricing, toPricingEngineConfig } = require('../services/pricingService');
const { getPricingConfig } = require('../services/pricingConfigService');
const {
  createFraudAlert,
  evaluateOrderRisk,
  evaluateRefundRisk,
  mergeUserFraudFlags,
  toSeverity,
} = require('../services/fraudDetectionService');
const {
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  reverseOrderSettlement,
  settleDeliveredOrder,
  settleRiderWallet,
  settleVendorWallet,
} = require('../services/financeService');
const { hasRole } = require('../middleware/authorizationMiddleware');

function isRiderUser(user) {
  return hasRole(user, ['rider']);
}

function isAdminUser(user) {
  return hasRole(user, ['admin', 'super_admin']);
}

function serializeOrder(order) {
  if (!order) {
    return null;
  }

  const source = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    id: source._id?.toString() || source.id || '',
    userId: source.userId || '',
    storeId: source.storeId?.toString() || '',
    riderId: source.riderId || '',
    items: Array.isArray(source.items)
      ? source.items.map((item) => ({
          productId: item.productId?.toString() || '',
          name: item.name || '',
          price: Number(item.price || 0),
          quantity: Number(item.quantity || 0),
          size: item.size || '',
          image: item.image || '',
        }))
      : [],
    subtotalAmount: Number(source.subtotalAmount || 0),
    productAmount: Number(source.productAmount || source.subtotalAmount || 0),
    taxAmount: Number(source.taxAmount || 0),
    deliveryFee: Number(source.deliveryFee || 0),
    deliveryDistanceKm: Number(source.deliveryDistanceKm || 0),
    discountAmount: Number(source.discountAmount || 0),
    discountPercent: Number(source.discountPercent || 0),
    tryAtHomeFee: Number(source.tryAtHomeFee || 0),
    tryAtHomeFeeRefundable: Boolean(source.tryAtHomeFeeRefundable),
    totalAmount: Number(source.totalAmount || 0),
    commissionPercent: Number(source.commissionPercent || 0),
    platformCommission: Number(source.platformCommission || 0),
    vendorEarnings: Number(source.vendorEarnings || 0),
    riderEarnings: Number(source.riderEarnings || 0),
    paymentGatewayFee: Number(source.paymentGatewayFee || 0),
    platformRevenue: Number(source.platformRevenue || 0),
    platformCost: Number(source.platformCost || 0),
    platformProfit: Number(source.platformProfit || 0),
    pricingBreakdown: source.pricingBreakdown || {},
    paymentMethod: source.paymentMethod || '',
    paymentStatus: source.paymentStatus || '',
    escrowStatus: source.escrowStatus || 'held',
    escrowReleasedAt: source.escrowReleasedAt || '',
    escrowUpdatedAt: source.escrowUpdatedAt || '',
    payoutStatus: source.payoutStatus || 'none',
    riderPayoutStatus: source.riderPayoutStatus || 'none',
    payoutId: source.payoutId || '',
    riderPayoutId: source.riderPayoutId || '',
    payoutProcessed: Boolean(source.payoutProcessed),
    isSuspicious: Boolean(source.isSuspicious),
    fraudStatus: source.fraudStatus || 'clear',
    riskScore: Number(source.riskScore || 0),
    riskReasons: Array.isArray(source.riskReasons) ? source.riskReasons : [],
    refundStatus: source.refundStatus || 'none',
    returnStatus: source.returnStatus || 'none',
    refundRequestId: source.refundRequestId || '',
    returnRequestId: source.returnRequestId || '',
    orderStatus: source.orderStatus || '',
    deliveryStatus: source.deliveryStatus || 'Pending',
    assignedDeliveryPartner: source.assignedDeliveryPartner || 'Unassigned',
    trackingId: source.trackingId || '',
    trackingTimestamps: source.trackingTimestamps || {},
    riderLatitude: source.riderLatitude ?? null,
    riderLongitude: source.riderLongitude ?? null,
    riderLocationUpdatedAt: source.riderLocationUpdatedAt || '',
    fulfillmentType: source.fulfillmentType || 'marketplace',
    customOrderStatus: source.customOrderStatus || 'none',
    customMeasurements: source.customMeasurements || {},
    atelierCustomization: source.atelierCustomization || {},
    measurementMethod: source.measurementMethod || '',
    atelierStatus: source.atelierStatus || 'none',
    atelierTailoringCharge: Number(source.atelierTailoringCharge || 0),
    atelierCustomizationCharge: Number(source.atelierCustomizationCharge || 0),
    atelierHomeVisitCharge: Number(source.atelierHomeVisitCharge || 0),
    customDesignOptions: source.customDesignOptions || {},
    referenceImageUrl: source.referenceImageUrl || '',
    previewImageUrl: source.previewImageUrl || '',
    vendorFinalImageUrl: source.vendorFinalImageUrl || '',
    selectedDesignerName: source.selectedDesignerName || '',
    qualityApprovalStatus: source.qualityApprovalStatus || 'not_required',
    measurementsConfirmedByVendor: Boolean(source.measurementsConfirmedByVendor),
    preDispatchChecklistCompletedAt: source.preDispatchChecklistCompletedAt || '',
    customerFitFeedbackStatus: source.customerFitFeedbackStatus || 'pending',
    customerFitRating: Number(source.customerFitRating || 0),
    customerQualityRating: Number(source.customerQualityRating || 0),
    customerDeliveryRating: Number(source.customerDeliveryRating || 0),
    customerFitFeedbackNotes: source.customerFitFeedbackNotes || '',
    customerFitRespondedAt: source.customerFitRespondedAt || '',
    alterationStatus: source.alterationStatus || 'none',
    alterationRequestedAt: source.alterationRequestedAt || '',
    alterationResolvedAt: source.alterationResolvedAt || '',
    alterationNotes: source.alterationNotes || '',
    customProductionTimeDays: Number(source.customProductionTimeDays || 0),
    customizationSummary: source.customizationSummary || '',
    shippingAddress: source.shippingAddress || {},
    razorpay: source.razorpay || {},
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function applyCustomVendorPenalty(store, averageScore) {
  if (!store || store.vendorType !== 'custom_vendor') {
    return;
  }
  const profile = store.customVendorProfile?.toObject?.() ??
    store.customVendorProfile ??
    {};
  const penaltyIncrement = averageScore < 2 ? 2 : 1;
  const penaltyPoints = Number(profile.penaltyPoints || 0) + penaltyIncrement;
  let qualityTier = 'watchlist';
  let activeCustomOrderLimit = Number(profile.activeCustomOrderLimit || 0);

  if (penaltyPoints >= 6) {
    qualityTier = 'suspended';
    activeCustomOrderLimit = 0;
    store.isActive = false;
  } else if (penaltyPoints >= 3) {
    qualityTier = 'restricted';
    activeCustomOrderLimit = 3;
  }

  store.customVendorProfile = {
    ...profile,
    qualityTier,
    penaltyPoints,
    activeCustomOrderLimit,
  };
  await store.save();
}

async function submitCustomFitFeedback(req, res, next) {
  try {
    const orderId = String(req.params?.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (order.fulfillmentType !== 'custom_tailoring') {
      return res.status(400).json({ success: false, message: 'Fit feedback is available only for custom orders.' });
    }
    if (order.customOrderStatus !== 'delivered' && order.orderStatus !== 'delivered') {
      return res.status(400).json({ success: false, message: 'Fit feedback can only be submitted after delivery.' });
    }

    const fitRating = Number(req.body?.fitRating || 0);
    const qualityRating = Number(req.body?.qualityRating || 0);
    const deliveryRating = Number(req.body?.deliveryRating || 0);
    const notes = String(req.body?.notes || '').trim();
    const needsAlteration = req.body?.needsAlteration === true;

    order.customerFitRating = Math.min(5, Math.max(0, fitRating));
    order.customerQualityRating = Math.min(5, Math.max(0, qualityRating));
    order.customerDeliveryRating = Math.min(5, Math.max(0, deliveryRating));
    order.customerFitFeedbackNotes = notes;
    order.customerFitRespondedAt = new Date().toISOString();
    order.customerFitFeedbackStatus = needsAlteration
      ? 'alteration_requested'
      : fitRating >= 4 && qualityRating >= 4
          ? 'fit_good'
          : 'issue_reported';
    if (needsAlteration) {
      order.alterationStatus = 'requested';
      order.alterationRequestedAt = order.alterationRequestedAt || new Date().toISOString();
      order.alterationNotes = notes;
      order.customOrderStatus = 'accepted';
      order.orderStatus = 'processing';
    }
    await order.save();

    const averageScore =
      (order.customerFitRating + order.customerQualityRating + order.customerDeliveryRating) / 3;
    if (averageScore > 0 && averageScore < 3.2) {
      const store = await Store.findById(order.storeId);
      await applyCustomVendorPenalty(store, averageScore);
    }

    return res.status(200).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function requestCustomAlteration(req, res, next) {
  try {
    const orderId = String(req.params?.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    if (order.fulfillmentType !== 'custom_tailoring') {
      return res.status(400).json({ success: false, message: 'Alteration is available only for custom orders.' });
    }

    const notes = String(req.body?.notes || '').trim();
    order.alterationStatus = 'requested';
    order.alterationRequestedAt = new Date().toISOString();
    order.alterationNotes = notes;
    order.customerFitFeedbackStatus = 'alteration_requested';
    order.customOrderStatus = 'accepted';
    order.orderStatus = 'processing';
    await order.save();

    return res.status(200).json({
      success: true,
      data: serializeOrder(order),
      message: 'Alteration requested and routed back to the same vendor.',
    });
  } catch (error) {
    return next(error);
  }
}

function serializeRefundRequest(refund) {
  if (!refund) {
    return null;
  }
  const source = typeof refund.toObject === 'function' ? refund.toObject() : refund;
  return {
    id: source._id?.toString() || source.id || '',
    orderId: source.orderId?.toString() || '',
    userId: source.userId || '',
    reason: source.reason || '',
    requestedAmount: Number(source.requestedAmount || 0),
    refundedAmount: Number(source.refundedAmount || 0),
    status: source.status || 'pending',
    createdAt: source.createdAt || null,
    processedAt: source.processedAt || '',
    processedBy: source.processedBy || '',
    rejectionReason: source.rejectionReason || '',
    gatewayRefundId: source.gatewayRefundId || '',
    fraudScore: Number(source.fraudScore || 0),
    fraudDecision: source.fraudDecision || 'approve',
    fraudReasons: Array.isArray(source.fraudReasons) ? source.fraudReasons : [],
  };
}

function serializeReturnRequest(request) {
  if (!request) {
    return null;
  }
  const source = typeof request.toObject === 'function' ? request.toObject() : request;
  return {
    id: source._id?.toString() || source.id || '',
    orderId: source.orderId?.toString() || '',
    userId: source.userId || '',
    address: source.address || '',
    reason: source.reason || '',
    status: source.status || 'requested',
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || source.createdAt || null,
    riderId: source.riderId || '',
    pickupTaskId: source.pickupTaskId || '',
    approvedAt: source.approvedAt || '',
    pickedAt: source.pickedAt || '',
    completedAt: source.completedAt || '',
    processedBy: source.processedBy || '',
    imageUrl: source.imageUrl || '',
    rejectionReason: source.rejectionReason || '',
    refundRequestId: source.refundRequestId || '',
  };
}

function buildTrackingId(orderId, storeId) {
  const compactOrderId = orderId.toString().slice(-6).toUpperCase();
  const compactStoreId = (storeId || '').toString().slice(-4).toUpperCase() || 'ABZO';
  return `TRK-${compactStoreId}-${compactOrderId}`;
}

function trackingKeyForOrderStatus(status) {
  switch ((status || '').toLowerCase()) {
    case 'created':
    case 'pending':
      return 'Order Placed';
    case 'confirmed':
      return 'Confirmed';
    case 'processing':
      return 'Packed';
    case 'shipped':
      return 'Out for delivery';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Order Placed';
  }
}

function trackingKeyForDeliveryStatus(status) {
  switch ((status || '').toLowerCase()) {
    case 'ready for pickup':
      return 'Confirmed';
    case 'assigned':
    case 'picked up':
      return 'Packed';
    case 'out for delivery':
      return 'Out for delivery';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

function appendTrackingTimestamp(order, key) {
  if (!key) {
    return;
  }
  const timestamps = { ...(order.trackingTimestamps || {}) };
  if (!timestamps[key]) {
    timestamps[key] = new Date().toISOString();
  }
  order.trackingTimestamps = timestamps;
}

function referrerRewardForCompletedInvites(completedInvites) {
  if (completedInvites >= 10) {
    return 150;
  }
  if (completedInvites >= 4) {
    return 100;
  }
  return 75;
}

async function processReferralRewardIfEligible(userId, order) {
  const actor = await User.findOne({ uid: userId });
  const referrerId = actor?.referredBy || '';
  if (!actor || !referrerId || Number(order?.totalAmount || 0) < 499) {
    return;
  }

  const existing = await ReferralRecord.findOne({
    referrerId,
    referredUserId: userId,
  });
  if (!existing || existing.rewardGiven) {
    return;
  }

  const referrer = await User.findOne({ uid: referrerId });
  if (!referrer) {
    return;
  }

  const completedBefore = await ReferralRecord.countDocuments({
    referrerId,
    rewardGiven: true,
  });
  const referrerReward = referrerRewardForCompletedInvites(completedBefore + 1);
  const friendReward = 75;
  const nowIso = new Date().toISOString();

  existing.status = 'completed';
  existing.rewardGiven = true;
  existing.referrerReward = referrerReward;
  existing.friendReward = friendReward;
  existing.completedAt = nowIso;
  existing.qualifyingOrderId = order._id.toString();
  existing.qualifyingOrderAmount = Number(order.totalAmount || 0);
  await existing.save();

  referrer.walletBalance = Number(referrer.walletBalance || 0) + referrerReward;
  actor.walletBalance = Number(actor.walletBalance || 0) + friendReward;
  await Promise.all([referrer.save(), actor.save()]);
}

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are missing.');
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function isValidHmacSignature(expectedHex, providedHex) {
  const expectedBuffer = Buffer.from(String(expectedHex || '').trim(), 'utf8');
  const providedBuffer = Buffer.from(String(providedHex || '').trim(), 'utf8');
  if (!expectedBuffer.length || expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function buildRazorpayReceipt(orderId) {
  const compactOrderId = orderId.toString().slice(-12);
  const timestamp = Date.now().toString().slice(-8);
  return `abz_${compactOrderId}_${timestamp}`;
}

function canManageDelivery(req) {
  return isRiderUser(req.user) || isAdminUser(req.user);
}

function canManageRefunds(req) {
  return isAdminUser(req.user);
}

function canManageReturns(req) {
  return hasRole(req.user, ['rider', 'admin', 'super_admin']);
}

async function deductInventoryAtomically(items, session) {
  // Security hardening: enforce stock >= quantity in a transaction-safe write.
  // This prevents overselling when multiple payment/order requests race.
  // Security/performance hardening: deterministic lock order lowers contention risk.
  const orderedItems = [...(items || [])].sort((left, right) =>
    String(left?.productId || '').localeCompare(String(right?.productId || ''))
  );
  for (const item of orderedItems) {
    const quantity = Number(item?.quantity || 0);
    const productId = item?.productId;
    if (!productId || quantity <= 0) {
      continue;
    }
    const result = await Product.updateOne(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { session },
    );
    if (!result || result.modifiedCount !== 1) {
      const stockError = new Error('Insufficient stock for one or more products.');
      stockError.statusCode = 409;
      throw stockError;
    }
  }
}

function buildOutboxEventId(prefix, orderId) {
  return `${prefix}:${orderId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function shippingAddressLabel(order) {
  return [
    order?.shippingAddress?.name,
    order?.shippingAddress?.addressLine1,
    order?.shippingAddress?.addressLine2,
    order?.shippingAddress?.city,
    order?.shippingAddress?.state,
    order?.shippingAddress?.pincode,
  ]
    .map((part) => part?.toString().trim() || '')
    .filter(Boolean)
    .join(', ');
}

function isRefundEligible(order) {
  if (!order) {
    return false;
  }
  const paymentMethod = (order.paymentMethod || '').toUpperCase();
  const paymentStatus = (order.paymentStatus || '').toLowerCase();
  const refundStatus = (order.refundStatus || '').toLowerCase();
  if (paymentMethod !== 'RAZORPAY' || paymentStatus !== 'paid') {
    return false;
  }
  return !['requested', 'pending', 'approved', 'refunded'].includes(refundStatus);
}

function isReturnEligible(order) {
  if (!order) {
    return false;
  }
  const orderStatus = (order.orderStatus || '').toLowerCase();
  const returnStatus = (order.returnStatus || '').toLowerCase();
  if (orderStatus !== 'delivered') {
    return false;
  }
  return !['requested', 'approved', 'assigned', 'picked', 'completed'].includes(returnStatus);
}

async function processRazorpayRefund(order, refundRequest, amountRupees = null) {
  const paymentId = order?.razorpay?.paymentId || '';
  if (!paymentId) {
    throw new Error('A valid online payment reference is required before refunding.');
  }

  const razorpay = getRazorpayClient();
  const resolvedAmount = Number(amountRupees || order.totalAmount || 0);
  const amount = Math.round(Math.max(0, resolvedAmount) * 100);
  if (!amount) {
    throw new Error('Refund amount must be greater than zero.');
  }
  const refund = await razorpay.payments.refund(paymentId, {
    amount,
    notes: {
      orderId: order._id.toString(),
      refundRequestId: refundRequest._id.toString(),
      reason: refundRequest.reason || '',
    },
  });

  return refund;
}

function isOrderAvailableForRider(order) {
  const status = (order.orderStatus || '').toLowerCase();
  const delivery = (order.deliveryStatus || '').toLowerCase();
  const closed = status === 'delivered' || status === 'cancelled' || delivery === 'delivered' || delivery === 'cancelled';
  const ready = status === 'confirmed' || status === 'shipped' || delivery === 'ready for pickup';
  return !closed && !order.riderId && ready;
}

function canManageFinance(req) {
  return isAdminUser(req.user);
}

function toTitleCase(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateLabel(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function addDays(value, days) {
  const base = new Date(value || Date.now());
  if (Number.isNaN(base.getTime())) {
    return '';
  }
  base.setDate(base.getDate() + Number(days || 0));
  return base.toISOString();
}

function isSameDayOrderEligible(store) {
  if (!store?.sameDay?.enabled) {
    return false;
  }
  const cutoffHour = Number(store.sameDay?.cutoffHour ?? 16);
  const now = new Date();
  return now.getHours() <= cutoffHour;
}

function sanitizeDistanceKm(rawDistance) {
  const numeric = Number(rawDistance);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(25, Math.max(0, numeric));
}

function haversineDistanceKm(fromLat, fromLng, toLat, toLng) {
  const values = [fromLat, fromLng, toLat, toLng].map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [lat1, lon1, lat2, lon2] = values;
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function resolveDeliveryDistanceKm({ requestedDistanceKm, store, user }) {
  const explicitDistance = sanitizeDistanceKm(requestedDistanceKm);
  if (explicitDistance > 0) {
    return explicitDistance;
  }

  const computedDistance = haversineDistanceKm(
    user?.latitude,
    user?.longitude,
    store?.latitude,
    store?.longitude,
  );
  return computedDistance == null ? 0 : sanitizeDistanceKm(computedDistance);
}

function resolveOrderTaxAmount({ subtotalAmount, items = [] }) {
  const safeSubtotal = Math.max(0, Number(subtotalAmount || 0));
  if (safeSubtotal <= 0) {
    return 0;
  }

  const configuredRate = Number(process.env.ORDER_TAX_RATE || process.env.DEFAULT_TAX_RATE || 18);
  const taxRate = Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : 18;
  const itemSubtotal = Array.isArray(items)
    ? items.reduce((sum, item) => {
        const price = Number(item?.price || item?.unitPrice || 0);
        const quantity = Number(item?.quantity || 0);
        return sum + Math.max(0, price * quantity);
      }, 0)
    : 0;
  const taxableBase = itemSubtotal > 0 ? itemSubtotal : safeSubtotal;
  return Number(((taxableBase * taxRate) / 100).toFixed(2));
}

function normalizeOptionalUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch (_) {
    return '';
  }
}

function normalizeStringArray(value, max = 12) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max);
}

function buildCustomizationSummary({ atelierCustomization = {}, measurementMethod = '', selectedDesignerName = '' }) {
  const parts = [];
  if (atelierCustomization.fabric) {
    parts.push(`Fabric: ${atelierCustomization.fabric}`);
  }
  if (atelierCustomization.color) {
    parts.push(`Color: ${atelierCustomization.color}`);
  }
  if (atelierCustomization.fitStyle) {
    parts.push(`Fit: ${atelierCustomization.fitStyle}`);
  }
  if (Array.isArray(atelierCustomization.addOns) && atelierCustomization.addOns.length > 0) {
    parts.push(`Add-ons: ${atelierCustomization.addOns.join(', ')}`);
  }
  if (measurementMethod) {
    parts.push(`Measurement: ${measurementMethod}`);
  }
  if (selectedDesignerName) {
    parts.push(`Atelier: ${selectedDesignerName}`);
  }
  return parts.join(' | ');
}

async function buildNormalizedOrderDraft(items) {
  const normalizedItems = [];
  const products = [];
  let subtotalAmount = 0;
  let resolvedStoreId = '';

  for (const item of items) {
    if (!mongoose.Types.ObjectId.isValid(item.productId)) {
      throw new Error('Invalid productId in order items.');
    }

    const product = await Product.findById(item.productId);
    if (!product || !product.isActive) {
      throw new Error(`Product not found for item ${item.productId}.`);
    }

    const productStoreId = product.storeId?.toString() || '';
    if (!productStoreId) {
      throw new Error('Product is not linked to a valid store.');
    }
    if (!resolvedStoreId) {
      resolvedStoreId = productStoreId;
    } else if (resolvedStoreId !== productStoreId) {
      throw new Error('Checkout currently supports one store per order.');
    }

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Valid quantity is required for product ${item.productId}.`);
    }
    if (product.stock < quantity) {
      throw new Error(`${product.name} is out of stock for quantity ${quantity}.`);
    }

    subtotalAmount += Number(product.price || 0) * quantity;
    products.push(product);
    normalizedItems.push({
      productId: product._id,
      name: product.name,
      price: product.price,
      quantity,
      size: item.size?.toString().trim() || '',
      image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '',
    });
  }

  return {
    products,
    normalizedItems,
    subtotalAmount,
    resolvedStoreId,
  };
}

async function buildPricingSnapshot({
  user,
  store,
  products,
  subtotalAmount,
  taxAmount,
  paymentMethod,
  requestedDistanceKm,
  tryAtHomeRequested = false,
  fulfillmentType = 'marketplace',
}) {
  const deliveryDistanceKm = resolveDeliveryDistanceKm({
    requestedDistanceKm,
    store,
    user,
  });
  const existingOrderCount = await Order.countDocuments({
    userId: user.uid,
    orderStatus: { $ne: 'cancelled' },
  });
  const riderCity = (store?.city || user?.city || '').trim();
  const riderFilter = {
    role: 'rider',
    riderAvailable: true,
    riderApprovalStatus: 'approved',
  };
  if (riderCity) {
    riderFilter.riderCity = riderCity;
  }

  const [availableRiderCount, activeDemandCount] = await Promise.all([
    User.countDocuments(riderFilter),
    Order.countDocuments({
      sameDayOrder: true,
      orderStatus: { $in: ['pending', 'created', 'confirmed', 'processing', 'shipped'] },
    }),
  ]);

  const avgDemandScore =
    products.length > 0
      ? products.reduce((sum, product) => sum + Number(product.demandScore || 0), 0) / products.length
      : 0;
  const avgFitRisk =
    products.length > 0
      ? products.reduce((sum, product) => sum + Number(product.fitRisk || 0), 0) / products.length
      : 0;
  const trialHomeSupported =
    Boolean(store?.sameDay?.supportsTrialHome) &&
    products.some((product) => product?.trialHome?.trialEnabled);
  const trialHomeFee =
    products
      .filter((product) => product?.trialHome?.trialEnabled)
      .reduce((maxFee, product) => Math.max(maxFee, Number(product?.trialHome?.trialFee || 0)), 99) || 99;
  const livePricingConfig = await getPricingConfig();

  return calculateOrderPricing({
    orderValue: subtotalAmount,
    taxAmount,
    distanceKm: deliveryDistanceKm,
    paymentMethod,
    existingOrderCount,
    userBehaviorMetrics: user.behaviorMetrics || {},
    fulfillmentType,
    vendorType: store.vendorType || 'standard_vendor',
    vendorId: store.ownerId || '',
    userId: user.uid,
    storeCommissionRate: store.commissionRate,
    storeRating: store.rating,
    storeReviewCount: store.reviewCount,
    customVendorProfile: store.customVendorProfile || {},
    availableRiderCount,
    activeDemandCount,
    avgDemandScore,
    avgFitRisk,
    tryAtHomeRequested,
    tryAtHomeSupported,
    trialFee: trialHomeFee,
    config: toPricingEngineConfig(livePricingConfig),
  });
}

function compactObjectSummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  return Object.entries(payload)
    .filter(([, value]) => value != null && value !== '' && typeof value !== 'object')
    .slice(0, 6)
    .map(([key, value]) => `${toTitleCase(key)}: ${String(value)}`)
    .join(', ');
}

function canAccessInvoice(req, order, store) {
  if (canManageFinance(req)) {
    return true;
  }
  if (req.user?.uid && req.user.uid === order.userId) {
    return true;
  }
  if (req.user?.role === 'vendor' && store?.ownerId && store.ownerId === req.user.uid) {
    return true;
  }
  return isRiderUser(req.user) && order.riderId && order.riderId === req.user.uid;
}

function buildInvoiceInput(order, customer, store) {
  const isCustom = order.fulfillmentType === 'custom_tailoring';
  const customDesign = order.customDesignOptions || {};
  const fitConfidence = order.customerFitRating > 0
    ? Math.min(100, Math.round((Number(order.customerFitRating || 0) / 5) * 100))
    : 92;
  const taxPercent = Number(order.subtotalAmount || 0) > 0
    ? ((Number(order.taxAmount || 0) / Number(order.subtotalAmount || 1)) * 100).toFixed(1)
    : '';

  const marketplaceItems = !isCustom
    ? (order.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        total: Number(item.price || 0) * Number(item.quantity || 0),
        size: item.size || '',
      }))
    : [];

  const customTailoringItems = isCustom
    ? (order.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        total: Number(item.price || 0) * Number(item.quantity || 0),
        fabric: customDesign.fabricType || customDesign.fabric || '',
        fit: customDesign.fitType || customDesign.fit || '',
        designDetails: order.customizationSummary || compactObjectSummary(customDesign),
      }))
    : [];

  const etaBase = order.trackingTimestamps?.Delivered
    || addDays(order.createdAt, order.customProductionTimeDays || 4);

  const shippingAddress = order.shippingAddress || {};

  return {
    orderId: order._id.toString(),
    invoiceDate: formatDateLabel(order.createdAt),
    customerName: shippingAddress.name || customer?.name || 'Abianzo Customer',
    customerAddressLine1: shippingAddress.addressLine1 || customer?.address || 'N/A',
    customerAddressLine2: shippingAddress.addressLine2 || customer?.area || '',
    customerCity: shippingAddress.city || customer?.city || 'N/A',
    customerState: shippingAddress.state || 'N/A',
    customerPostalCode: shippingAddress.pincode || 'N/A',
    customerCountry: 'India',
    customerPhone: shippingAddress.phone || customer?.phone || '',
    deliveryEstimatedDate: formatDateLabel(etaBase),
    deliveryMethod: isCustom ? 'White Glove Delivery' : 'Standard Delivery',
    deliveryTrackingId: order.trackingId || 'Pending assignment',
    deliveryAddress: shippingAddressLabel(order) || customer?.address || 'N/A',
    marketplaceItems,
    customTailoringItems,
    customFabric: customDesign.fabricType || customDesign.fabric || 'As selected',
    customFitProfile: customDesign.fitType || customDesign.fit || 'Personalized fit',
    fitConfidence,
    customDesignDetails: order.customizationSummary || compactObjectSummary(customDesign) || 'Tailored to your selected style details.',
    personalizationDetails: compactObjectSummary(order.customMeasurements) || order.customerFitFeedbackNotes || 'Profile-aligned measurements and style preferences.',
    craftedForYouMessage: isCustom
      ? 'Handcrafted with precision based on your measurements and design preferences.'
      : 'Curated and quality-checked to align with your signature style.',
    subtotal: Number(order.subtotalAmount || 0),
    taxLabel: taxPercent ? `GST ${taxPercent}%` : 'Tax',
    taxAmount: Number(order.taxAmount || 0),
    grandTotal: Number(order.totalAmount || 0),
    paymentMethod: order.paymentMethod || 'N/A',
    paymentStatus: toTitleCase(order.paymentStatus || 'pending'),
    transactionId: order.razorpay?.paymentId || order.razorpay?.orderId || 'N/A',
    vendorName: store?.name || 'Abianzo Partner Studio',
    vendorAddress: [store?.address, store?.city].filter(Boolean).join(', ') || 'N/A',
    vendorTaxId: 'N/A',
    vendorContact: customer?.phone || 'N/A',
    stylePersona: toTitleCase(customDesign.stylePersona || customDesign.style || 'Signature'),
    preferredSilhouette: toTitleCase(customDesign.silhouette || customDesign.fitType || 'Tailored'),
    occasionIntent: toTitleCase(customDesign.occasion || 'Elevated everyday'),
  };
}

async function createOrder(req, res, next) {
  try {
    const {
      items,
      paymentMethod,
      shippingAddress,
      taxAmount,
      deliveryDistanceKm,
      tryAtHomeRequested,
    } = req.body || {};
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order items are required.' });
    }

    const normalizedPaymentMethod = (paymentMethod || 'COD').toString().trim().toUpperCase() === 'COD' ? 'COD' : 'RAZORPAY';
    const normalizedShippingAddress = {
      name: shippingAddress?.name?.toString().trim() || '',
      phone: shippingAddress?.phone?.toString().trim() || '',
      addressLine1: shippingAddress?.addressLine1?.toString().trim() || '',
      addressLine2: shippingAddress?.addressLine2?.toString().trim() || '',
      city: shippingAddress?.city?.toString().trim() || '',
      state: shippingAddress?.state?.toString().trim() || '',
      pincode: shippingAddress?.pincode?.toString().trim() || '',
    };
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let draft;
    try {
      draft = await buildNormalizedOrderDraft(items);
    } catch (draftError) {
      const message = String(draftError.message || 'Invalid order items.');
      const status =
        message.includes('not found')
          ? 404
          : message.includes('out of stock') || message.includes('supports one store')
            ? 400
            : 400;
      return res.status(status).json({ success: false, message });
    }

    const {
      products,
      normalizedItems,
      subtotalAmount,
      resolvedStoreId,
    } = draft;

    const store = await Store.findById(resolvedStoreId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const sameDayOrder = isSameDayOrderEligible(store);
    const financials = await buildPricingSnapshot({
      user,
      store,
      products,
      subtotalAmount,
      taxAmount: resolveOrderTaxAmount({ subtotalAmount, items: normalizedItems }),
      paymentMethod: normalizedPaymentMethod,
      requestedDistanceKm: deliveryDistanceKm,
      tryAtHomeRequested: Boolean(tryAtHomeRequested),
      fulfillmentType: store.vendorType === 'custom_vendor' ? 'custom_tailoring' : 'marketplace',
    });

    const risk = await evaluateOrderRisk({
      user,
      store,
      req,
    });
    if (risk.decision === 'block') {
      await mergeUserFraudFlags(user.uid, { score: risk.riskScore, reasons: risk.reasons });
      await createFraudAlert({
        type: 'order',
        severity: toSeverity(risk.riskScore),
        userId: user.uid,
        storeId: resolvedStoreId,
        riskScore: risk.riskScore,
        reasons: risk.reasons,
        message: 'Order creation blocked by fraud rules.',
        ipAddress: risk.fingerprint.ipAddress,
        deviceId: risk.fingerprint.deviceId,
      });
      return res.status(429).json({
        success: false,
        message: 'Too many risky order attempts detected. Please try again later or contact support.',
      });
    }

    const order = await Order.create({
      userId: req.user.uid,
      storeId: resolvedStoreId,
      items: normalizedItems,
      subtotalAmount,
      productAmount: financials.productAmount,
      taxAmount: financials.taxAmount,
      deliveryFee: financials.deliveryFee,
      deliveryDistanceKm: financials.deliveryDistanceKm,
      discountAmount: financials.discountAmount,
      discountPercent: financials.discountPercent,
      tryAtHomeFee: financials.tryAtHomeFee,
      tryAtHomeFeeRefundable: financials.tryAtHomeFeeRefundable,
      totalAmount: financials.totalAmount,
      commissionPercent: financials.commissionPercent,
      platformCommission: financials.platformCommission,
      vendorEarnings: financials.vendorEarnings,
      riderEarnings: financials.riderEarnings,
      paymentGatewayFee: financials.paymentGatewayFee,
      platformRevenue: financials.platformRevenue,
      platformCost: financials.platformCost,
      platformProfit: financials.platformProfit,
      pricingBreakdown: financials.pricingBreakdown,
      paymentMethod: normalizedPaymentMethod,
      paymentStatus: normalizedPaymentMethod === 'COD' ? 'pending' : 'pending',
      escrowStatus: 'held',
      escrowUpdatedAt: new Date().toISOString(),
      orderStatus: normalizedPaymentMethod === 'COD' ? 'confirmed' : 'pending',
      deliveryStatus: normalizedPaymentMethod === 'COD' ? 'Ready for pickup' : 'Pending',
      sameDayOrder,
      payoutStatus: 'none',
      riderPayoutStatus: 'none',
      trackingId: '',
      trackingTimestamps: {},
      shippingAddress: normalizedShippingAddress,
      isSuspicious: risk.decision === 'review',
      fraudStatus: risk.decision === 'review' ? 'review' : 'clear',
      riskScore: risk.riskScore,
      riskReasons: risk.reasons,
      fraudSignals: risk.reasons,
      placedFromIp: risk.fingerprint.ipAddress,
      placedFromDeviceId: risk.fingerprint.deviceId,
    });

    order.trackingId = buildTrackingId(order._id, resolvedStoreId);
    appendTrackingTimestamp(order, 'Order Placed');
    if (normalizedPaymentMethod === 'COD') {
      appendTrackingTimestamp(order, 'Confirmed');
    }
    if (risk.decision === 'review') {
      await mergeUserFraudFlags(user.uid, { score: risk.riskScore, reasons: risk.reasons });
      await createFraudAlert({
        type: 'order',
        severity: toSeverity(risk.riskScore),
        userId: user.uid,
        storeId: resolvedStoreId,
        orderId: order._id.toString(),
        riskScore: risk.riskScore,
        reasons: risk.reasons,
        message: 'Order placed but marked suspicious for manual review.',
        ipAddress: risk.fingerprint.ipAddress,
        deviceId: risk.fingerprint.deviceId,
      });
    }

    if (normalizedPaymentMethod === 'COD') {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Security hardening: persist order and deduct inventory in one transaction.
          // Either both succeed or both rollback.
          await order.save({ session });
          if (!order.inventoryDeducted) {
            await deductInventoryAtomically(normalizedItems, session);
            order.inventoryDeducted = true;
          }
          await order.save({ session });
        });
      } finally {
        await session.endSession();
      }
    } else {
      await order.save();
    }
    if (normalizedPaymentMethod === 'COD') {
      await processReferralRewardIfEligible(req.user.uid, order);
    }

    try {
      await trackOutfitInteraction({
        userId: req.user.uid,
        action: 'purchase',
        itemIds: normalizedItems.map((item) => item.productId.toString()),
        metadata: {
          orderId: order._id.toString(),
          source: 'order_controller',
        },
      });
    } catch (trackingError) {
      console.warn('Purchase outfit tracking failed:', trackingError.message);
    }

    return res.status(201).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function quickCheckoutOrder(req, res, next) {
  try {
    const {
      productId,
      size = '',
      quantity = 1,
      paymentMethod = 'COD',
      shippingAddress = {},
    } = req.body || {};

    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
      return res.status(400).json({
        success: false,
        message: 'A valid productId is required for quick checkout.',
      });
    }

    req.body = {
      paymentMethod,
      shippingAddress,
      items: [
        {
          productId: String(productId),
          quantity: Number(quantity) > 0 ? Number(quantity) : 1,
          size: String(size || '').trim(),
        },
      ],
    };

    return createOrder(req, res, next);
  } catch (error) {
    return next(error);
  }
}

async function createAtelierOrder(req, res, next) {
  try {
    const {
      productId,
      quantity = 1,
      size = '',
      paymentMethod = 'RAZORPAY',
      shippingAddress,
      taxAmount = 0,
      deliveryDistanceKm = 0,
      atelierCustomization = {},
      customMeasurements = {},
      customDesignOptions = {},
      measurementMethod = 'standard',
      selectedDesignerName = '',
      referenceImageUrl = '',
      previewImageUrl = '',
    } = req.body || {};

    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(productId || ''))) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    const store = await Store.findById(product.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (!store.atelierConfig?.supportsCustomization || !product.atelier?.atelierEnabled) {
      return res.status(400).json({
        success: false,
        message: 'This product is not currently available as an atelier customization.',
      });
    }

    const normalizedMeasurementMethod = String(measurementMethod || 'standard').trim().toLowerCase();
    const allowedMeasurementOptions = Array.isArray(product.atelier?.allowedMeasurementOptions) &&
      product.atelier.allowedMeasurementOptions.length > 0
      ? product.atelier.allowedMeasurementOptions
      : store.atelierConfig?.measurementOptions || ['standard'];
    if (!allowedMeasurementOptions.includes(normalizedMeasurementMethod)) {
      return res.status(400).json({
        success: false,
        message: 'This measurement method is not available for the selected atelier product.',
      });
    }

    const safeQuantity = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 1;
    if (product.stock < safeQuantity) {
      return res.status(400).json({ success: false, message: 'Requested quantity is not available.' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const normalizedShippingAddress = {
      name: shippingAddress?.name?.toString().trim() || user.name || '',
      phone: shippingAddress?.phone?.toString().trim() || user.phone || '',
      addressLine1: shippingAddress?.addressLine1?.toString().trim() || user.address || '',
      addressLine2: shippingAddress?.addressLine2?.toString().trim() || '',
      city: shippingAddress?.city?.toString().trim() || user.city || '',
      state: shippingAddress?.state?.toString().trim() || '',
      pincode: shippingAddress?.pincode?.toString().trim() || '',
    };

    const baseAmount = Number(product.price || 0) * safeQuantity;
    const addOnOptions = normalizeStringArray(atelierCustomization?.addOns);
    const atelierCustomizationCharge =
      Number(store.atelierConfig?.atelierPricingRules?.customizationBaseCharge || 0) +
      addOnOptions.length * 50;
    const atelierTailoringCharge =
      Number(product.atelier?.baseTailoringCharge || 0) ||
      Number(store.atelierConfig?.atelierPricingRules?.tailoringCharge || 0);
    const atelierHomeVisitCharge =
      normalizedMeasurementMethod === 'visit'
        ? Number(product.atelier?.homeVisitCharge || store.atelierConfig?.atelierPricingRules?.homeVisitCharge || 0)
        : 0;
    const atelierSubtotalAmount = baseAmount + atelierCustomizationCharge + atelierTailoringCharge + atelierHomeVisitCharge;

    const financials = await buildPricingSnapshot({
      user,
      store,
      products: [product],
      subtotalAmount: atelierSubtotalAmount,
      taxAmount: resolveOrderTaxAmount({ subtotalAmount: atelierSubtotalAmount, items: [{ price: baseAmount, quantity: 1 }] }),
      paymentMethod: (paymentMethod || 'RAZORPAY').toString().trim().toUpperCase() === 'COD' ? 'COD' : 'RAZORPAY',
      requestedDistanceKm: deliveryDistanceKm,
      tryAtHomeRequested: normalizedMeasurementMethod === 'trial',
      fulfillmentType: 'custom_tailoring',
    });

    const normalizedAtelierCustomization = {
      fabric: String(atelierCustomization?.fabric || '').trim(),
      color: String(atelierCustomization?.color || '').trim(),
      fitStyle: String(atelierCustomization?.fitStyle || '').trim(),
      addOns: addOnOptions,
    };

    const order = await Order.create({
      userId: req.user.uid,
      storeId: store._id,
      items: [
        {
          productId: product._id,
          name: product.name,
          price: Number(product.price || 0),
          quantity: safeQuantity,
          size: String(size || '').trim(),
          image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '',
        },
      ],
      subtotalAmount: atelierSubtotalAmount,
      productAmount: baseAmount,
      taxAmount: financials.taxAmount,
      deliveryFee: financials.deliveryFee,
      deliveryDistanceKm: financials.deliveryDistanceKm,
      discountAmount: financials.discountAmount,
      discountPercent: financials.discountPercent,
      tryAtHomeFee: financials.tryAtHomeFee,
      tryAtHomeFeeRefundable: financials.tryAtHomeFeeRefundable,
      totalAmount: financials.totalAmount,
      commissionPercent: financials.commissionPercent,
      platformCommission: financials.platformCommission,
      vendorEarnings: financials.vendorEarnings,
      riderEarnings: financials.riderEarnings,
      paymentGatewayFee: financials.paymentGatewayFee,
      platformRevenue: financials.platformRevenue,
      platformCost: financials.platformCost,
      platformProfit: financials.platformProfit,
      pricingBreakdown: financials.pricingBreakdown,
      paymentMethod: (paymentMethod || 'RAZORPAY').toString().trim().toUpperCase() === 'COD' ? 'COD' : 'RAZORPAY',
      paymentStatus: 'pending',
      escrowStatus: 'held',
      escrowUpdatedAt: new Date().toISOString(),
      orderStatus: 'pending',
      deliveryStatus: 'Pending',
      sameDayOrder: isSameDayOrderEligible(store),
      payoutStatus: 'none',
      riderPayoutStatus: 'none',
      fulfillmentType: 'custom_tailoring',
      customOrderStatus: 'draft',
      atelierStatus: 'draft',
      measurementMethod: normalizedMeasurementMethod,
      atelierCustomization: normalizedAtelierCustomization,
      atelierTailoringCharge,
      atelierCustomizationCharge,
      atelierHomeVisitCharge,
      customMeasurements: customMeasurements && typeof customMeasurements === 'object' ? customMeasurements : {},
      customDesignOptions: customDesignOptions && typeof customDesignOptions === 'object'
        ? customDesignOptions
        : {},
      selectedDesignerName: String(selectedDesignerName || store.name).trim(),
      referenceImageUrl: normalizeOptionalUrl(referenceImageUrl),
      previewImageUrl: normalizeOptionalUrl(previewImageUrl),
      customProductionTimeDays: Number(store.atelierConfig?.tailoringTimeDaysMax || store.customVendorProfile?.productionTimeDays || 3),
      customizationSummary: buildCustomizationSummary({
        atelierCustomization: normalizedAtelierCustomization,
        measurementMethod: normalizedMeasurementMethod,
        selectedDesignerName: String(selectedDesignerName || store.name).trim(),
      }),
      shippingAddress: normalizedShippingAddress,
      trackingId: '',
      trackingTimestamps: {},
    });

    order.trackingId = buildTrackingId(order._id, store._id);
    appendTrackingTimestamp(order, 'Order Placed');
    await order.save();

    return res.status(201).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function getOrderPricingQuote(req, res, next) {
  try {
    const {
      items,
      productId,
      size = '',
      quantity = 1,
      paymentMethod = 'RAZORPAY',
      taxAmount = 0,
      deliveryDistanceKm = 0,
      tryAtHomeRequested = false,
    } = req.body || {};

    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const quoteItems = Array.isArray(items) && items.length > 0
      ? items
      : productId
        ? [
            {
              productId: String(productId),
              quantity: Number(quantity) > 0 ? Number(quantity) : 1,
              size: String(size || '').trim(),
            },
          ]
        : [];

    if (quoteItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Order items are required for pricing quote.' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    let draft;
    try {
      draft = await buildNormalizedOrderDraft(quoteItems);
    } catch (draftError) {
      const message = String(draftError.message || 'Invalid order items.');
      const status = message.includes('not found') ? 404 : 400;
      return res.status(status).json({ success: false, message });
    }

    const { products, normalizedItems, subtotalAmount, resolvedStoreId } = draft;
    const store = await Store.findById(resolvedStoreId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }

    const quote = await buildPricingSnapshot({
      user,
      store,
      products,
      subtotalAmount,
      taxAmount: resolveOrderTaxAmount({ subtotalAmount, items: normalizedItems }),
      paymentMethod: (paymentMethod || 'RAZORPAY').toString().trim().toUpperCase() === 'COD' ? 'COD' : 'RAZORPAY',
      requestedDistanceKm: deliveryDistanceKm,
      tryAtHomeRequested: Boolean(tryAtHomeRequested),
      fulfillmentType: store.vendorType === 'custom_vendor' ? 'custom_tailoring' : 'marketplace',
    });

    return res.status(200).json({
      success: true,
      data: {
        storeId: resolvedStoreId,
        items: normalizedItems,
        pricing: quote,
        sameDayEligible: isSameDayOrderEligible(store),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listAvailableDeliveryOrders(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageDelivery(req)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }

    const orders = await Order.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: orders.filter(isOrderAvailableForRider).map(serializeOrder),
    });
  } catch (error) {
    return next(error);
  }
}

async function listAssignedDeliveryOrders(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageDelivery(req)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }

    const orders = await Order.find({ riderId: req.user.uid }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: orders.map(serializeOrder) });
  } catch (error) {
    return next(error);
  }
}

async function acceptDelivery(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageDelivery(req)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (!isOrderAvailableForRider(order) && order.riderId !== req.user.uid) {
      return res.status(400).json({ success: false, message: 'This delivery is not available for pickup.' });
    }
    if (order.riderId && order.riderId !== req.user.uid) {
      return res.status(409).json({ success: false, message: 'Delivery already accepted by another rider.' });
    }

    order.riderId = req.user.uid;
    order.assignedDeliveryPartner = req.user.name || 'Assigned Rider';
    order.deliveryStatus = 'Assigned';
    appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));
    await order.save();

    return res.status(200).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function updateDeliveryStatus(req, res, next) {
  try {
    const { id } = req.params;
    const nextStatus = req.body?.deliveryStatus?.toString().trim() || '';
    const allowed = ['Assigned', 'Picked up', 'Out for delivery', 'Delivered'];
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageDelivery(req)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!allowed.includes(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Unsupported delivery status.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.riderId !== req.user.uid && !['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }

    order.deliveryStatus = nextStatus;
    if (nextStatus === 'Picked up') {
      order.orderStatus = 'processing';
    } else if (nextStatus === 'Out for delivery') {
      order.orderStatus = 'shipped';
    } else if (nextStatus === 'Delivered') {
      order.orderStatus = 'delivered';
      order.paymentStatus = order.paymentMethod === 'COD' ? 'paid' : order.paymentStatus;
    }
    appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(nextStatus));
    appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
    const shouldSettleDelivered = nextStatus === 'Delivered';
    await order.save();
    if (shouldSettleDelivered) {
      await settleDeliveredOrder(order);
    }
    await recordTrackingEvent({
      eventType: 'order_status_update',
      orderId: order._id.toString(),
      riderId: order.riderId || '',
      userId: order.userId || '',
      payload: {
        deliveryStatus: nextStatus,
        orderStatus: order.orderStatus,
      },
    });

    return res.status(200).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function updateRiderLocation(req, res, next) {
  try {
    const { id } = req.params;
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageDelivery(req)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: 'Valid rider coordinates are required.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.riderId !== req.user.uid && !['admin', 'super_admin'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }

    order.riderLatitude = latitude;
    order.riderLongitude = longitude;
    order.riderLocationUpdatedAt = new Date().toISOString();
    await order.save();
    await recordTrackingEvent({
      eventType: 'location_update',
      orderId: order._id.toString(),
      riderId: order.riderId || req.user.uid,
      userId: order.userId || '',
      latitude,
      longitude,
      payload: {
        source: 'order_location_patch',
      },
    });

    return res.status(200).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function listStoreOrders(req, res, next) {
  try {
    const { storeId } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only view orders for your own store.' });
    }

    const orders = await Order.find({ storeId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: orders.map(serializeOrder) });
  } catch (error) {
    return next(error);
  }
}

async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const normalizedStatus = status?.toString().trim().toLowerCase() || '';
    const statusMap = {
      placed: 'created',
      confirmed: 'confirmed',
      processing: 'processing',
      shipped: 'shipped',
      delivered: 'delivered',
      cancelled: 'cancelled',
    };

    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!Object.prototype.hasOwnProperty.call(statusMap, normalizedStatus)) {
      return res.status(400).json({ success: false, message: 'Unsupported order status.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const store = await Store.findById(order.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only update orders for your own store.' });
    }

    order.orderStatus = statusMap[normalizedStatus];
    if (order.orderStatus === 'confirmed') {
      order.deliveryStatus = 'Ready for pickup';
    } else if (order.orderStatus === 'processing') {
      order.deliveryStatus = order.riderId ? 'Picked up' : 'Assigned';
    } else if (order.orderStatus === 'shipped') {
      order.deliveryStatus = 'Out for delivery';
    } else if (order.orderStatus === 'delivered') {
      order.deliveryStatus = 'Delivered';
      order.paymentStatus = order.paymentMethod === 'COD' ? 'paid' : order.paymentStatus;
    } else if (order.orderStatus === 'cancelled') {
      order.deliveryStatus = 'Cancelled';
    }

    if (order.orderStatus === 'confirmed' && order.paymentMethod === 'COD') {
      order.paymentStatus = 'pending';
    }
    appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
    appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));
    if (order.orderStatus === 'delivered') {
      await settleDeliveredOrder(order);
    } else if (order.orderStatus === 'cancelled') {
      await reverseOrderSettlement(order, 'Order cancelled');
    }
    await order.save();

    return res.status(200).json({ success: true, data: serializeOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function cancelOrder(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own orders.' });
    }

    const orderStatus = (order.orderStatus || '').toLowerCase();
    const deliveryStatus = (order.deliveryStatus || '').toLowerCase();
    const isLocked =
      orderStatus === 'shipped' ||
      orderStatus === 'delivered' ||
      orderStatus === 'cancelled' ||
      deliveryStatus === 'out for delivery' ||
      deliveryStatus === 'delivered' ||
      deliveryStatus === 'cancelled';
    if (isLocked) {
      return res.status(409).json({
        success: false,
        message: 'This order can no longer be cancelled.',
      });
    }

    order.orderStatus = 'cancelled';
    order.deliveryStatus = 'Cancelled';
    appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
    appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));
    let cancellationRefund = null;
    let refundFailureMessage = '';
    const shouldAutoRefund =
      (order.paymentMethod || '').toUpperCase() === 'RAZORPAY' &&
      (order.paymentStatus || '').toLowerCase() === 'paid';
    if (shouldAutoRefund) {
      // Security hardening: cancellation refund intent is idempotent.
      // Repeated cancel retries reuse an existing pending/approved refund request.
      let refundRequest = await RefundRequest.findOne({
        orderId: order._id,
        userId: order.userId,
        status: { $in: ['pending', 'approved'] },
      }).sort({ createdAt: -1, _id: -1 });
      if (!refundRequest) {
        refundRequest = new RefundRequest({
          orderId: order._id,
          userId: order.userId,
          reason: 'Order cancelled by customer before delivery.',
          requestedAmount: Number(order.totalAmount || 0),
          refundedAmount: 0,
          status: 'pending',
        });
        await refundRequest.save();
      }
      cancellationRefund = refundRequest;
      order.refundRequestId = refundRequest._id.toString();
      try {
        const gatewayRefund = await processRazorpayRefund(order, refundRequest, Number(order.totalAmount || 0));
        refundRequest.status = 'approved';
        refundRequest.processedAt = new Date().toISOString();
        refundRequest.processedBy = req.user.uid;
        refundRequest.gatewayRefundId = gatewayRefund?.id || '';
        refundRequest.refundedAmount = Number(order.totalAmount || 0);
        await refundRequest.save();
        order.paymentStatus = 'refunded';
        order.refundStatus = 'refunded';
        order.escrowStatus = 'refunded';
        order.escrowUpdatedAt = new Date().toISOString();
      } catch (refundError) {
        refundFailureMessage = String(refundError?.message || 'Refund gateway failed');
        order.refundStatus = 'requested';
      }
    }

    await reverseOrderSettlement(order, 'Order cancelled by customer');
    await order.save();

    return res.status(200).json({
      success: true,
      data: serializeOrder(order),
      refund: serializeRefundRequest(cancellationRefund),
      refundPending: Boolean(refundFailureMessage),
      refundMessage: refundFailureMessage ||
        (shouldAutoRefund ? 'Auto-refund processed successfully.' : 'No auto-refund required.'),
    });
  } catch (error) {
    return next(error);
  }
}

async function listUserOrders(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const orders = await Order.find({ userId: req.user.uid }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: orders.map(serializeOrder) });
  } catch (error) {
    return next(error);
  }
}

async function getRefundRequestForOrder(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid && !canManageRefunds(req)) {
      return res.status(403).json({ success: false, message: 'Refund access denied.' });
    }

    const refund = await RefundRequest.findOne({ orderId: id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: serializeRefundRequest(refund) });
  } catch (error) {
    return next(error);
  }
}

async function listRefundRequests(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const status = req.query?.status?.toString().trim().toLowerCase() || 'all';
    const filter = canManageRefunds(req) ? {} : { userId: req.user.uid };
    if (status !== 'all') {
      filter.status = status;
    }
    const requests = await RefundRequest.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: requests.map(serializeRefundRequest) });
  } catch (error) {
    return next(error);
  }
}

async function createRefundRequest(req, res, next) {
  try {
    const { id } = req.params;
    const reason = req.body?.reason?.toString().trim() || '';
    const requestedAmountRaw = Number(req.body?.amount || 0);
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Refund reason is required.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid && !canManageRefunds(req)) {
      return res.status(403).json({ success: false, message: 'You can only request a refund for your own order.' });
    }
    if (!isRefundEligible(order)) {
      return res.status(400).json({ success: false, message: 'This order is not eligible for a refund right now.' });
    }

    const existing = await RefundRequest.findOne({ orderId: id }).sort({ createdAt: -1 });
    if (existing && existing.status !== 'rejected') {
      return res.status(400).json({ success: false, message: 'A refund request already exists for this order.' });
    }

    const refundFraud = await evaluateRefundRisk({ userId: order.userId });

    const requestedAmount =
      requestedAmountRaw > 0
        ? Math.min(requestedAmountRaw, Number(order.totalAmount || 0))
        : Number(order.totalAmount || 0);

    const refund = await RefundRequest.create({
      orderId: order._id,
      userId: order.userId,
      reason,
      status: 'pending',
      requestedAmount,
      refundedAmount: 0,
      fraudScore: refundFraud.riskScore,
      fraudDecision: refundFraud.decision === 'clear' ? 'approve' : refundFraud.decision,
      fraudReasons: refundFraud.reasons,
    });

    order.refundStatus = 'requested';
    order.refundRequestId = refund._id.toString();
    if (refundFraud.decision !== 'clear') {
      order.isSuspicious = true;
      order.fraudStatus = 'review';
      order.riskScore = Math.max(Number(order.riskScore || 0), refundFraud.riskScore);
      order.riskReasons = Array.from(new Set([...(order.riskReasons || []), ...refundFraud.reasons]));
      await mergeUserFraudFlags(order.userId, {
        score: refundFraud.riskScore,
        reasons: refundFraud.reasons,
      });
      await createFraudAlert({
        type: 'refund',
        severity: toSeverity(refundFraud.riskScore),
        userId: order.userId,
        storeId: order.storeId?.toString() || '',
        orderId: order._id.toString(),
        refundRequestId: refund._id.toString(),
        riskScore: refundFraud.riskScore,
        reasons: refundFraud.reasons,
        message: 'Refund request requires fraud review.',
      });
    }
    await order.save();

    return res.status(201).json({ success: true, data: serializeRefundRequest(refund) });
  } catch (error) {
    return next(error);
  }
}

async function approveRefundRequest(req, res, next) {
  try {
    const { refundId } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageRefunds(req)) {
      return res.status(403).json({ success: false, message: 'Refund approval access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(refundId)) {
      return res.status(400).json({ success: false, message: 'Invalid refund request id.' });
    }

    const refund = await RefundRequest.findById(refundId);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund request not found.' });
    }
    if (refund.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'This refund request has already been processed.' });
    }

    const order = await Order.findById(refund.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const requestedAmountRaw = Number(req.body?.amount || 0);
    const refundAmount = requestedAmountRaw > 0
      ? Math.min(requestedAmountRaw, Number(order.totalAmount || 0))
      : Number(refund.requestedAmount || order.totalAmount || 0);
    const gatewayRefund = await processRazorpayRefund(order, refund, refundAmount);
    refund.status = 'approved';
    refund.processedAt = new Date().toISOString();
    refund.processedBy = req.user.uid;
    refund.gatewayRefundId = gatewayRefund?.id || '';
    refund.refundedAmount = refundAmount;
    await refund.save();

    const fullRefund = refundAmount >= Number(order.totalAmount || 0);
    order.paymentStatus = fullRefund ? 'refunded' : order.paymentStatus;
    order.refundStatus = fullRefund ? 'refunded' : 'approved';
    order.refundRequestId = refund._id.toString();
    if (fullRefund) {
      await reverseOrderSettlement(order, 'Refund approved');
    }
    await order.save();

    return res.status(200).json({ success: true, data: serializeRefundRequest(refund) });
  } catch (error) {
    return next(error);
  }
}

async function rejectRefundRequest(req, res, next) {
  try {
    const { refundId } = req.params;
    const reason = req.body?.reason?.toString().trim() || '';
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageRefunds(req)) {
      return res.status(403).json({ success: false, message: 'Refund approval access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(refundId)) {
      return res.status(400).json({ success: false, message: 'Invalid refund request id.' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Add a reason before rejecting this refund.' });
    }

    const refund = await RefundRequest.findById(refundId);
    if (!refund) {
      return res.status(404).json({ success: false, message: 'Refund request not found.' });
    }
    if (refund.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'This refund request has already been processed.' });
    }

    const order = await Order.findById(refund.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    refund.status = 'rejected';
    refund.processedAt = new Date().toISOString();
    refund.processedBy = req.user.uid;
    refund.rejectionReason = reason;
    await refund.save();

    order.refundStatus = 'rejected';
    order.refundRequestId = refund._id.toString();
    await order.save();

    return res.status(200).json({ success: true, data: serializeRefundRequest(refund) });
  } catch (error) {
    return next(error);
  }
}

async function getReturnRequestForOrder(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid && !canManageReturns(req)) {
      return res.status(403).json({ success: false, message: 'Return access denied.' });
    }

    const request = await ReturnRequest.findOne({ orderId: id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: serializeReturnRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function listReturnRequests(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const status = req.query?.status?.toString().trim().toLowerCase() || 'all';
    const filter = canManageReturns(req) ? {} : { userId: req.user.uid };
    if (status !== 'all') {
      filter.status = status;
    }
    const requests = await ReturnRequest.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: requests.map(serializeReturnRequest) });
  } catch (error) {
    return next(error);
  }
}

async function createReturnRequest(req, res, next) {
  try {
    const { id } = req.params;
    const reason = req.body?.reason?.toString().trim() || '';
    const imageUrl = req.body?.imageUrl?.toString().trim() || '';
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Return reason is required.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.userId !== req.user.uid && !canManageReturns(req)) {
      return res.status(403).json({ success: false, message: 'You can only request a return for your own order.' });
    }
    if (!isReturnEligible(order)) {
      return res.status(400).json({ success: false, message: 'This order is not eligible for return right now.' });
    }

    const existing = await ReturnRequest.findOne({ orderId: id }).sort({ createdAt: -1 });
    if (existing && existing.status !== 'rejected') {
      return res.status(400).json({ success: false, message: 'A return request already exists for this order.' });
    }

    const request = await ReturnRequest.create({
      orderId: order._id,
      userId: order.userId,
      address: shippingAddressLabel(order) || 'Pickup address unavailable',
      reason,
      status: 'requested',
      imageUrl,
    });

    order.returnStatus = 'requested';
    order.returnRequestId = request._id.toString();
    await order.save();

    return res.status(201).json({ success: true, data: serializeReturnRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function approveReturnRequest(req, res, next) {
  try {
    const { returnId } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageRefunds(req)) {
      return res.status(403).json({ success: false, message: 'Return approval access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(400).json({ success: false, message: 'Invalid return request id.' });
    }

    const request = await ReturnRequest.findById(returnId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Return request not found.' });
    }
    if (!['requested', 'assigned'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'This return request has already been processed.' });
    }

    const order = await Order.findById(request.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    request.status = request.riderId ? 'assigned' : 'approved';
    request.approvedAt = new Date().toISOString();
    request.processedBy = req.user.uid;
    await request.save();

    order.returnStatus = request.status;
    order.returnRequestId = request._id.toString();
    await order.save();

    return res.status(200).json({ success: true, data: serializeReturnRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function rejectReturnRequest(req, res, next) {
  try {
    const { returnId } = req.params;
    const reason = req.body?.reason?.toString().trim() || '';
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageRefunds(req)) {
      return res.status(403).json({ success: false, message: 'Return approval access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(400).json({ success: false, message: 'Invalid return request id.' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Add a reason before rejecting this return.' });
    }

    const request = await ReturnRequest.findById(returnId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Return request not found.' });
    }

    const order = await Order.findById(request.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    request.status = 'rejected';
    request.rejectionReason = reason;
    request.completedAt = new Date().toISOString();
    request.processedBy = req.user.uid;
    await request.save();

    order.returnStatus = 'rejected';
    order.returnRequestId = request._id.toString();
    await order.save();

    return res.status(200).json({ success: true, data: serializeReturnRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function markReturnPicked(req, res, next) {
  try {
    const { returnId } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageReturns(req)) {
      return res.status(403).json({ success: false, message: 'Pickup access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(400).json({ success: false, message: 'Invalid return request id.' });
    }

    const request = await ReturnRequest.findById(returnId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Return request not found.' });
    }
    if (!['approved', 'assigned'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'Only approved returns can be marked as picked.' });
    }
    if (
      isRiderUser(req.user) &&
      request.riderId &&
      request.riderId !== req.user.uid
    ) {
      return res.status(403).json({ success: false, message: 'This return is assigned to another rider.' });
    }

    const order = await Order.findById(request.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    request.status = 'picked';
    request.pickedAt = new Date().toISOString();
    request.processedBy = req.user.uid;
    if (!request.riderId && isRiderUser(req.user)) {
      request.riderId = req.user.uid;
    }
    await request.save();

    order.returnStatus = 'picked';
    order.returnRequestId = request._id.toString();
    await order.save();

    return res.status(200).json({ success: true, data: serializeReturnRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function completeReturnRequest(req, res, next) {
  try {
    const { returnId } = req.params;
    const qualityApproved = req.body?.qualityApproved !== false;
    const rejectionReason = req.body?.rejectionReason?.toString().trim() || '';
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canManageReturns(req)) {
      return res.status(403).json({ success: false, message: 'Return completion access denied.' });
    }
    if (!mongoose.Types.ObjectId.isValid(returnId)) {
      return res.status(400).json({ success: false, message: 'Invalid return request id.' });
    }

    const request = await ReturnRequest.findById(returnId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Return request not found.' });
    }
    if (!['picked', 'approved', 'assigned'].includes(request.status)) {
      return res.status(400).json({ success: false, message: 'This return is not ready for completion.' });
    }
    if (isRiderUser(req.user) && request.riderId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'This return is assigned to another rider.' });
    }

    const order = await Order.findById(request.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (!qualityApproved) {
      request.status = 'rejected';
      request.rejectionReason = rejectionReason || 'The returned item did not pass quality verification.';
      request.completedAt = new Date().toISOString();
      request.processedBy = req.user.uid;
      await request.save();

      order.returnStatus = 'rejected';
      order.returnRequestId = request._id.toString();
      await order.save();

      return res.status(200).json({ success: true, data: serializeReturnRequest(request) });
    }

    let refund = await RefundRequest.findOne({ orderId: order._id }).sort({ createdAt: -1 });
    if (!refund && isRefundEligible(order)) {
      refund = await RefundRequest.create({
        orderId: order._id,
        userId: order.userId,
        reason: `Return completed: ${request.reason}`,
        status: 'pending',
      });
    }

    if (refund && refund.status === 'pending') {
      const gatewayRefund = await processRazorpayRefund(order, refund);
      refund.status = 'approved';
      refund.processedAt = new Date().toISOString();
      refund.processedBy = req.user.uid;
      refund.gatewayRefundId = gatewayRefund?.id || '';
      await refund.save();
      order.refundStatus = 'refunded';
      order.paymentStatus = 'refunded';
      order.refundRequestId = refund._id.toString();
    }

    request.status = 'completed';
    request.completedAt = new Date().toISOString();
    request.processedBy = req.user.uid;
    request.refundRequestId = refund?._id?.toString() || request.refundRequestId || '';
    await request.save();

    order.returnStatus = 'completed';
    order.returnRequestId = request._id.toString();
    await reverseOrderSettlement(order, 'Return completed');
    await order.save();

    return res.status(200).json({ success: true, data: serializeReturnRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function createRazorpayOrder(req, res, next) {
  try {
    const { orderId } = req.body || {};
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Valid orderId is required.' });
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user.uid });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.paymentStatus === 'paid') {
      return res.status(200).json({
        success: true,
        data: {
          orderId: order.razorpay?.orderId || '',
          amount: Math.round(Number(order.totalAmount) * 100),
          currency: 'INR',
          receipt: order.razorpay?.receipt || '',
          status: 'paid',
        },
      });
    }

    const razorpay = getRazorpayClient();
    const receipt = buildRazorpayReceipt(order._id);
    const amountInPaise = Math.round(Number(order.totalAmount) * 100);
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes: {
        appOrderId: order._id.toString(),
        userId: req.user.uid,
      },
    });

    order.razorpay = {
      ...order.razorpay,
      orderId: razorpayOrder.id,
      receipt,
    };
    await order.save();

    return res.status(200).json({
      success: true,
      data: {
        orderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function downloadOrderInvoicePdf(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const [customer, store] = await Promise.all([
      User.findOne({ uid: order.userId }),
      Store.findById(order.storeId),
    ]);

    if (!canAccessInvoice(req, order, store)) {
      return res.status(403).json({ success: false, message: 'Invoice access denied.' });
    }

    const invoiceInput = buildInvoiceInput(order, customer, store);
    const { pdfBuffer } = await generatePremiumInvoicePdf(invoiceInput);
    const filename = `Abianzo-Invoice-${order._id.toString()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return next(error);
  }
}

async function verifyPayment(req, res, next) {
  try {
    const razorpayOrderId =
      req.body?.razorpay_order_id?.toString().trim() ||
      req.body?.orderId?.toString().trim() ||
      '';
    const razorpayPaymentId =
      req.body?.razorpay_payment_id?.toString().trim() ||
      req.body?.paymentId?.toString().trim() ||
      '';
    const razorpaySignature =
      req.body?.razorpay_signature?.toString().trim() ||
      req.body?.signature?.toString().trim() ||
      '';
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required.',
      });
    }

    const order = await Order.findOne({
      userId: req.user.uid,
      'razorpay.orderId': razorpayOrderId,
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.paymentStatus === 'paid') {
      return res.status(200).json({
        success: true,
        data: {
          verified: true,
          paymentStatus: order.paymentStatus,
          orderStatus: order.orderStatus,
          message: 'Payment already verified.',
        },
      });
    }
    if (!order.razorpay?.orderId) {
      return res.status(400).json({ success: false, message: 'No Razorpay order linked to this order.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || '';
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: 'Payment verification is unavailable right now. Please contact support.',
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!isValidHmacSignature(expectedSignature, razorpaySignature)) {
      order.paymentStatus = 'failed';
      order.razorpay = {
        ...order.razorpay,
        paymentId: razorpayPaymentId,
        signature: razorpaySignature,
      };
      await order.save();
      await Transaction.create({
        transactionId: `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'payment',
        userType: 'admin',
        userId: order.userId,
        storeId: order.storeId?.toString() || '',
        orderId: order._id.toString(),
        amount: Number(order.totalAmount || 0),
        status: 'failed',
        note: 'Payment signature verification failed.',
        createdAtIso: new Date().toISOString(),
        metadata: {
          razorpayOrderId,
          razorpayPaymentId,
        },
      });
      return res.status(400).json({ success: false, message: 'Invalid Razorpay signature.' });
    }

    const razorpay = getRazorpayClient();
    const payment = await razorpay.payments.fetch(razorpayPaymentId);
    const paymentOrderId = String(payment?.order_id || '').trim();
    const paymentCurrency = String(payment?.currency || '').trim().toUpperCase();
    const paymentAmountPaise = Number(payment?.amount || 0);
    const expectedAmountPaise = Math.round(Number(order.totalAmount || 0) * 100);
    const paymentAppOrderId = String(payment?.notes?.appOrderId || '').trim();

    // Security hardening: payment verification now binds gateway payment to
    // expected order id + expected appOrderId + expected currency + exact amount.
    // This prevents payment tampering/underpayment acceptance.
    const paid = Boolean(
      payment &&
      payment.status === 'captured' &&
      paymentOrderId === razorpayOrderId &&
      paymentCurrency === 'INR' &&
      Number.isFinite(paymentAmountPaise) &&
      paymentAmountPaise === expectedAmountPaise &&
      paymentAppOrderId === order._id.toString()
    );

    let savedOrder = order;
    let outboxEventId = '';
    if (paid) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Security hardening: payment state + inventory deduction must be atomic.
          const txOrder = await Order.findById(order._id).session(session);
          if (!txOrder) {
            const missing = new Error('Order not found.');
            missing.statusCode = 404;
            throw missing;
          }
          txOrder.paymentStatus = 'paid';
          txOrder.orderStatus = 'confirmed';
          txOrder.deliveryStatus = 'Ready for pickup';
          txOrder.razorpay = {
            ...txOrder.razorpay,
            paymentId: razorpayPaymentId,
            signature: razorpaySignature,
          };
          txOrder.escrowStatus = 'held';
          txOrder.escrowUpdatedAt = new Date().toISOString();
          appendTrackingTimestamp(txOrder, trackingKeyForOrderStatus(txOrder.orderStatus));
          appendTrackingTimestamp(txOrder, trackingKeyForDeliveryStatus(txOrder.deliveryStatus));
          if (!txOrder.inventoryDeducted) {
            await deductInventoryAtomically(txOrder.items, session);
            txOrder.inventoryDeducted = true;
          }
          txOrder.financialReversed = false;
          await txOrder.save({ session });
          // Security hardening: durable outbox marker is committed in the same transaction.
          // If post-commit logging fails, this event remains for replay/reconciliation.
          outboxEventId = buildOutboxEventId('payment_captured_verify', txOrder._id.toString());
          await PaymentOutboxEvent.create(
            [{
              eventId: outboxEventId,
              eventType: 'payment_captured_verify',
              orderId: txOrder._id.toString(),
              payload: {
                razorpayOrderId,
                razorpayPaymentId,
              },
              metadata: {
                traceId: telemetry.getContext().traceId || '',
                spanId: telemetry.getContext().spanId || '',
                requestId: telemetry.getContext().requestId || '',
              },
            }],
            { session },
          );
          savedOrder = txOrder;
        });
      } finally {
        await session.endSession();
      }
    } else {
      order.paymentStatus = 'failed';
      order.orderStatus = 'pending';
      order.deliveryStatus = 'Pending';
      order.razorpay = {
        ...order.razorpay,
        paymentId: razorpayPaymentId,
        signature: razorpaySignature,
      };
      appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
      appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));
      await order.save();
      savedOrder = order;
    }
    try {
      await Transaction.create({
        transactionId: `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'payment',
        userType: 'admin',
        userId: savedOrder.userId,
        storeId: savedOrder.storeId?.toString() || '',
        orderId: savedOrder._id.toString(),
        amount: Number(savedOrder.totalAmount || 0),
        status: paid ? 'captured' : 'failed',
        note: paid ? 'Payment captured and escrow held.' : 'Payment verification failed.',
        createdAtIso: new Date().toISOString(),
          metadata: {
            razorpayOrderId,
            razorpayPaymentId,
            paymentCurrency,
            paymentAmountPaise: String(paymentAmountPaise),
            expectedAmountPaise: String(expectedAmountPaise),
            paymentAppOrderId,
          },
        });
    } catch (sideEffectError) {
      // Security hardening: do not rollback successful payment/order commit because
      // of telemetry/logging write failures. Keep a durable outbox marker for replay.
      if (outboxEventId) {
        await PaymentOutboxEvent.updateOne(
          { eventId: outboxEventId },
          { $set: { status: 'failed', processedAtIso: new Date().toISOString(), lastError: String(sideEffectError?.message || sideEffectError) } },
        );
      }
    }
    if (paid) {
      await processReferralRewardIfEligible(req.user.uid, savedOrder);
      await enqueueInvoiceJob(savedOrder._id.toString(), 'payment_verify_success');
      if (outboxEventId) {
        await PaymentOutboxEvent.updateOne(
          { eventId: outboxEventId },
          { $set: { status: 'processed', processedAtIso: new Date().toISOString(), lastError: '' } },
        );
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        verified: paid,
        paymentStatus: savedOrder.paymentStatus,
        orderStatus: savedOrder.orderStatus,
        payment,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createOrder,
  createAtelierOrder,
  quickCheckoutOrder,
  getOrderPricingQuote,
  resolveOrderTaxAmount,
  acceptDelivery,
  listUserOrders,
  listAssignedDeliveryOrders,
  listAvailableDeliveryOrders,
  listStoreOrders,
  getRefundRequestForOrder,
  listRefundRequests,
  createRefundRequest,
  approveRefundRequest,
  rejectRefundRequest,
  getReturnRequestForOrder,
  listReturnRequests,
  createReturnRequest,
  approveReturnRequest,
  rejectReturnRequest,
  markReturnPicked,
  completeReturnRequest,
  createRazorpayOrder,
  requestCustomAlteration,
  submitCustomFitFeedback,
  updateDeliveryStatus,
  updateOrderStatus,
  cancelOrder,
  updateRiderLocation,
  downloadOrderInvoicePdf,
  processRazorpayRefund,
  verifyPayment,
};


