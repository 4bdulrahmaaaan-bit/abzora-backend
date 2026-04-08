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
const { trackOutfitInteraction } = require('../services/outfitEngine');
const {
  createFraudAlert,
  evaluateOrderRisk,
  evaluateRefundRisk,
  mergeUserFraudFlags,
  toSeverity,
} = require('../services/fraudDetectionService');
const {
  calculateOrderFinancials,
  createWithdrawalRequest,
  financeConfig,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  reverseOrderSettlement,
  settleDeliveredOrder,
  settleRiderWallet,
  settleVendorWallet,
} = require('../services/financeService');

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
    totalAmount: Number(source.totalAmount || 0),
    platformCommission: Number(source.platformCommission || 0),
    vendorEarnings: Number(source.vendorEarnings || 0),
    riderEarnings: Number(source.riderEarnings || 0),
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
  return req.user?.role === 'rider' || req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

function canManageRefunds(req) {
  return req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

function canManageReturns(req) {
  return req.user?.role === 'rider' || req.user?.role === 'admin' || req.user?.role === 'super_admin';
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
  return req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

async function createOrder(req, res, next) {
  try {
    const { items, paymentMethod, shippingAddress, taxAmount, deliveryFee, deliveryDistanceKm } = req.body || {};
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order items are required.' });
    }

    const normalizedItems = [];
    let subtotalAmount = 0;
    let resolvedStoreId = '';
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

    for (const item of items) {
      if (!mongoose.Types.ObjectId.isValid(item.productId)) {
        return res.status(400).json({ success: false, message: 'Invalid productId in order items.' });
      }

      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) {
        return res.status(404).json({
          success: false,
          message: `Product not found for item ${item.productId}.`,
        });
      }

      const productStoreId = product.storeId?.toString() || '';
      if (!productStoreId) {
        return res.status(400).json({ success: false, message: 'Product is not linked to a valid store.' });
      }
      if (!resolvedStoreId) {
        resolvedStoreId = productStoreId;
      } else if (resolvedStoreId !== productStoreId) {
        return res.status(400).json({
          success: false,
          message: 'Checkout currently supports one store per order.',
        });
      }

      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Valid quantity is required for product ${item.productId}.`,
        });
      }
      if (product.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is out of stock for quantity ${quantity}.`,
        });
      }

      subtotalAmount += product.price * quantity;
      normalizedItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity,
        size: item.size?.toString().trim() || '',
        image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '',
      });
    }

    const store = await Store.findById(resolvedStoreId);
    const financials = calculateOrderFinancials({
      subtotalAmount,
      taxAmount,
      deliveryFee,
      deliveryDistanceKm,
      commissionPercent: store?.commissionRate,
    });

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

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
      totalAmount: financials.totalAmount,
      platformCommission: financials.platformCommission,
      vendorEarnings: financials.vendorEarnings,
      riderEarnings: financials.riderEarnings,
      paymentMethod: normalizedPaymentMethod,
      paymentStatus: normalizedPaymentMethod === 'COD' ? 'pending' : 'pending',
      escrowStatus: 'held',
      escrowUpdatedAt: new Date().toISOString(),
      orderStatus: normalizedPaymentMethod === 'COD' ? 'confirmed' : 'pending',
      deliveryStatus: normalizedPaymentMethod === 'COD' ? 'Ready for pickup' : 'Pending',
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

    if (normalizedPaymentMethod === 'COD' && !order.inventoryDeducted) {
      for (const item of normalizedItems) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
      }
      order.inventoryDeducted = true;
    }
    await order.save();
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
    if (!allowed.contains(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Unsupported delivery status.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.riderId !== req.user.uid && !['admin', 'super_admin'].contains(req.user?.role)) {
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
    await settleDeliveredOrder(order);
    await order.save();

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
    if (!latitude.isFinite || !longitude.isFinite) {
      return res.status(400).json({ success: false, message: 'Valid rider coordinates are required.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (order.riderId !== req.user.uid && !['admin', 'super_admin'].contains(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Rider access denied.' });
    }

    order.riderLatitude = latitude;
    order.riderLongitude = longitude;
    order.riderLocationUpdatedAt = new Date().toISOString();
    await order.save();

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
    if (!statusMap.containsKey(normalizedStatus)) {
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
    const shouldAutoRefund =
      (order.paymentMethod || '').toUpperCase() === 'RAZORPAY' &&
      (order.paymentStatus || '').toLowerCase() === 'paid';
    if (shouldAutoRefund) {
      const refundRequest = await RefundRequest.create({
        orderId: order._id,
        userId: order.userId,
        reason: 'Order cancelled by customer before delivery.',
        requestedAmount: Number(order.totalAmount || 0),
        refundedAmount: 0,
        status: 'pending',
      });
      const gatewayRefund = await processRazorpayRefund(order, refundRequest, Number(order.totalAmount || 0));
      refundRequest.status = 'approved';
      refundRequest.processedAt = new Date().toISOString();
      refundRequest.processedBy = req.user.uid;
      refundRequest.gatewayRefundId = gatewayRefund?.id || '';
      refundRequest.refundedAmount = Number(order.totalAmount || 0);
      await refundRequest.save();
      cancellationRefund = refundRequest;
      order.paymentStatus = 'refunded';
      order.refundStatus = 'refunded';
      order.refundRequestId = refundRequest._id.toString();
      order.escrowStatus = 'refunded';
      order.escrowUpdatedAt = new Date().toISOString();
    }

    await reverseOrderSettlement(order, 'Order cancelled by customer');
    await order.save();

    return res.status(200).json({
      success: true,
      data: serializeOrder(order),
      refund: serializeRefundRequest(cancellationRefund),
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

    const order = await Order.findById(request.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    request.status = 'picked';
    request.pickedAt = new Date().toISOString();
    request.processedBy = req.user.uid;
    if (!request.riderId && req.user.role === 'rider') {
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
    const paid = payment && (payment.status === 'captured' || payment.status === 'authorized');

    order.paymentStatus = paid ? 'paid' : 'failed';
    order.orderStatus = paid ? 'confirmed' : 'pending';
    order.deliveryStatus = paid ? 'Ready for pickup' : 'Pending';
    order.razorpay = {
      ...order.razorpay,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    };
    order.escrowStatus = paid ? 'held' : order.escrowStatus;
    order.escrowUpdatedAt = paid ? new Date().toISOString() : order.escrowUpdatedAt;
    appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
    appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));

    if (paid && !order.inventoryDeducted) {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
      }
      order.inventoryDeducted = true;
    }
    if (paid) {
      order.financialReversed = false;
    }
    await order.save();
    await Transaction.create({
      transactionId: `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'payment',
      userType: 'admin',
      userId: order.userId,
      storeId: order.storeId?.toString() || '',
      orderId: order._id.toString(),
      amount: Number(order.totalAmount || 0),
      status: paid ? 'captured' : 'failed',
      note: paid ? 'Payment captured and escrow held.' : 'Payment verification failed.',
      createdAtIso: new Date().toISOString(),
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
      },
    });
    if (paid) {
      await processReferralRewardIfEligible(req.user.uid, order);
    }

    return res.status(200).json({
      success: true,
      data: {
        verified: paid,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        payment,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createOrder,
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
  verifyPayment,
};
