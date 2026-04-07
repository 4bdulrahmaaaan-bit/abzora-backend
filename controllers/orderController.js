const crypto = require('crypto');

const Razorpay = require('razorpay');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Store = require('../models/Store');
const { trackOutfitInteraction } = require('../services/outfitEngine');

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
    totalAmount: Number(source.totalAmount || 0),
    paymentMethod: source.paymentMethod || '',
    paymentStatus: source.paymentStatus || '',
    orderStatus: source.orderStatus || '',
    deliveryStatus: source.deliveryStatus || 'Pending',
    assignedDeliveryPartner: source.assignedDeliveryPartner || 'Unassigned',
    trackingId: source.trackingId || '',
    trackingTimestamps: source.trackingTimestamps || {},
    riderLatitude: source.riderLatitude ?? null,
    riderLongitude: source.riderLongitude ?? null,
    riderLocationUpdatedAt: source.riderLocationUpdatedAt || '',
    shippingAddress: source.shippingAddress || {},
    razorpay: source.razorpay || {},
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
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

function buildRazorpayReceipt(orderId) {
  const compactOrderId = orderId.toString().slice(-12);
  const timestamp = Date.now().toString().slice(-8);
  return `abz_${compactOrderId}_${timestamp}`;
}

function canManageDelivery(req) {
  return req.user?.role === 'rider' || req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

function isOrderAvailableForRider(order) {
  const status = (order.orderStatus || '').toLowerCase();
  const delivery = (order.deliveryStatus || '').toLowerCase();
  const closed = status === 'delivered' || status === 'cancelled' || delivery === 'delivered' || delivery === 'cancelled';
  const ready = status === 'confirmed' || status === 'shipped' || delivery === 'ready for pickup';
  return !closed && !order.riderId && ready;
}

async function createOrder(req, res, next) {
  try {
    const { items, paymentMethod, shippingAddress } = req.body || {};
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

    const order = await Order.create({
      userId: req.user.uid,
      storeId: resolvedStoreId,
      items: normalizedItems,
      subtotalAmount,
      totalAmount: subtotalAmount,
      paymentMethod: normalizedPaymentMethod,
      paymentStatus: normalizedPaymentMethod === 'COD' ? 'pending' : 'pending',
      orderStatus: normalizedPaymentMethod === 'COD' ? 'confirmed' : 'pending',
      deliveryStatus: normalizedPaymentMethod === 'COD' ? 'Ready for pickup' : 'Pending',
      trackingId: '',
      trackingTimestamps: {},
      shippingAddress: normalizedShippingAddress,
    });

    order.trackingId = buildTrackingId(order._id, resolvedStoreId);
    appendTrackingTimestamp(order, 'Order Placed');
    if (normalizedPaymentMethod === 'COD') {
      appendTrackingTimestamp(order, 'Confirmed');
    }

    if (normalizedPaymentMethod === 'COD' && !order.inventoryDeducted) {
      for (const item of normalizedItems) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
      }
      order.inventoryDeducted = true;
    }
    await order.save();

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
    await order.save();

    return res.status(200).json({ success: true, data: serializeOrder(order) });
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

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      order.paymentStatus = 'failed';
      order.razorpay = {
        ...order.razorpay,
        paymentId: razorpayPaymentId,
        signature: razorpaySignature,
      };
      await order.save();
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
    appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
    appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));

    if (paid && !order.inventoryDeducted) {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } });
      }
      order.inventoryDeducted = true;
    }
    await order.save();

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
  createRazorpayOrder,
  updateDeliveryStatus,
  updateOrderStatus,
  updateRiderLocation,
  verifyPayment,
};
