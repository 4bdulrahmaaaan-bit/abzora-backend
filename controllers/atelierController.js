const mongoose = require('mongoose');
const Order = require('../models/Order');
const MeasurementProfile = require('../models/MeasurementProfile');
const {
  atelierCatalog,
  findStyleById,
  findFabricById,
} = require('../config/atelierConfig');

function sanitizeMeasurement(input) {
  const value = Number(input || 0);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function sanitizeIndex(input) {
  const value = Number(input || 0);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function computeAtelierPricing({
  style,
  fabric,
  neckIndex = 0,
  sleeveIndex = 0,
  lengthIndex = 0,
  measurementMode = 'manual',
}) {
  const pricingConfig = atelierCatalog.pricing;
  const basePrice = Number(style?.basePrice || 0);
  const fabricDelta = Number(fabric?.delta || 0);
  const stitchingCharge = Math.round(basePrice * pricingConfig.stitchingMultiplier);
  const addOnCharge =
    sanitizeIndex(neckIndex) * pricingConfig.necklineDelta +
    sanitizeIndex(sleeveIndex) * pricingConfig.sleeveDelta +
    sanitizeIndex(lengthIndex) * pricingConfig.lengthDelta +
    (measurementMode === 'manual' ? pricingConfig.manualMeasurementCharge : 0);

  return {
    basePrice,
    fabricDelta,
    stitchingCharge,
    addOnCharge,
    total: basePrice + fabricDelta + stitchingCharge + addOnCharge,
  };
}

function deriveTrackingSteps(order) {
  const source = typeof order.toObject === 'function' ? order.toObject() : order;
  const timestamps = source.trackingTimestamps || {};
  const atelierStatus = String(source.atelierStatus || '').toLowerCase();
  const orderStatus = String(source.orderStatus || '').toLowerCase();

  const cuttingDone =
    Boolean(timestamps['Fabric Cutting']) ||
    ['confirmed', 'measuring', 'stitching', 'ready', 'pickup', 'delivered'].includes(
      atelierStatus
    ) ||
    ['processing', 'shipped', 'delivered'].includes(orderStatus);
  const stitchingDone =
    Boolean(timestamps['Stitching']) ||
    ['stitching', 'ready', 'pickup', 'delivered'].includes(atelierStatus) ||
    ['shipped', 'delivered'].includes(orderStatus);
  const finishingDone =
    Boolean(timestamps['Finishing']) ||
    ['ready', 'pickup', 'delivered'].includes(atelierStatus);
  const deliveryDone =
    Boolean(timestamps['Delivery']) ||
    atelierStatus === 'delivered' ||
    orderStatus === 'delivered';

  return [
    {
      key: 'cutting',
      label: 'Fabric Cutting',
      completed: cuttingDone,
      completedAt: timestamps['Fabric Cutting'] || '',
    },
    {
      key: 'stitching',
      label: 'Stitching',
      completed: stitchingDone,
      completedAt: timestamps['Stitching'] || '',
    },
    {
      key: 'finishing',
      label: 'Finishing',
      completed: finishingDone,
      completedAt: timestamps['Finishing'] || '',
    },
    {
      key: 'delivery',
      label: 'Delivery',
      completed: deliveryDone,
      completedAt: timestamps['Delivery'] || '',
    },
  ];
}

function toPublicOrder(orderDoc) {
  if (!orderDoc) {
    return null;
  }
  const order = typeof orderDoc.toObject === 'function' ? orderDoc.toObject() : orderDoc;
  return {
    id: order._id?.toString() || '',
    orderNumber: order.trackingId || `ATL-${(order._id?.toString() || '').slice(-8).toUpperCase()}`,
    userId: order.userId || '',
    boutiqueId: order.storeId?.toString() || '',
    boutiqueName: order.selectedDesignerName || '',
    styleId: '',
    styleName: (order.items && order.items[0]?.name) || '',
    fabricId: '',
    fabricName: order.atelierCustomization?.fabric || '',
    design: order.customDesignOptions || {},
    measurementMode: order.measurementMethod || '',
    measurements: order.customMeasurements || {},
    pricing: {
      basePrice: Number(order.productAmount || order.subtotalAmount || 0),
      fabricDelta: 0,
      stitchingCharge: Number(order.atelierTailoringCharge || 0),
      addOnCharge:
        Number(order.atelierCustomizationCharge || 0) + Number(order.atelierHomeVisitCharge || 0),
      total: Number(order.totalAmount || 0),
    },
    status: order.atelierStatus || order.customOrderStatus || order.orderStatus || 'draft',
    deliveryTimelineText: '10-14 days including fit confirmation',
    trackingSteps: deriveTrackingSteps(order),
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
  };
}

async function getCatalog(req, res, next) {
  try {
    return res.status(200).json({
      success: true,
      data: atelierCatalog,
    });
  } catch (error) {
    return next(error);
  }
}

async function getQuote(req, res, next) {
  try {
    const {
      styleId = '',
      fabricId = '',
      neckIndex = 0,
      sleeveIndex = 0,
      lengthIndex = 0,
      measurementMode = 'manual',
    } = req.body || {};

    const style = findStyleById(String(styleId).trim());
    const fabric = findFabricById(String(fabricId).trim());
    if (!style || !fabric) {
      return res.status(400).json({
        success: false,
        message: 'Valid styleId and fabricId are required.',
      });
    }
    if (!atelierCatalog.measurementModes.includes(measurementMode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid measurement mode.',
      });
    }

    const pricing = computeAtelierPricing({
      style,
      fabric,
      neckIndex,
      sleeveIndex,
      lengthIndex,
      measurementMode,
    });

    return res.status(200).json({
      success: true,
      data: {
        styleId: style.id,
        styleName: style.name,
        fabricId: fabric.id,
        fabricName: fabric.name,
        pricing,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMeasurementProfile(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { label = 'Atelier Profile', method = 'manual', measurements = {} } = req.body || {};
    const chest = sanitizeMeasurement(measurements.chest);
    const waist = sanitizeMeasurement(measurements.waist);
    const length = sanitizeMeasurement(measurements.length);
    if (method !== 'manual' && method !== 'saved' && method !== 'ai') {
      return res.status(400).json({
        success: false,
        message: 'Invalid measurement mode.',
      });
    }

    const profile = await MeasurementProfile.create({
      userId: req.user.uid,
      label: String(label || 'Atelier Profile').trim() || 'Atelier Profile',
      method,
      unit: 'in',
      chest,
      waist,
      length,
    });

    return res.status(201).json({
      success: true,
      data: {
        id: profile._id.toString(),
        label: profile.label,
        method: profile.method,
        chest: profile.chest,
        waist: profile.waist,
        length: profile.length,
        unit: profile.unit,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listMyAtelierOrders(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const orders = await Order.find({
      userId: req.user.uid,
      fulfillmentType: 'custom_tailoring',
    }).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: orders.map(toPublicOrder),
    });
  } catch (error) {
    return next(error);
  }
}

async function getAtelierOrderTracking(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const orderId = String(req.params?.id || '').trim();
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order id is required.',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order id.',
      });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Atelier order not found.',
      });
    }
    if (order.userId !== req.user.uid && !['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }
    if (order.fulfillmentType !== 'custom_tailoring') {
      return res.status(400).json({
        success: false,
        message: 'This is not an atelier order.',
      });
    }
    return res.status(200).json({ success: true, data: toPublicOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function updateAtelierTracking(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.',
      });
    }
    const orderId = String(req.params?.id || '').trim();
    const stepKey = String(req.body?.stepKey || '').trim().toLowerCase();
    const completed = req.body?.completed !== false;
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order id.',
      });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Atelier order not found.',
      });
    }

    if (order.fulfillmentType !== 'custom_tailoring') {
      return res.status(400).json({
        success: false,
        message: 'This is not an atelier order.',
      });
    }
    const stepMap = {
      cutting: 'Fabric Cutting',
      stitching: 'Stitching',
      finishing: 'Finishing',
      delivery: 'Delivery',
    };
    const label = stepMap[stepKey];
    if (!label) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tracking step key.',
      });
    }
    const nextTimestamps = { ...(order.trackingTimestamps || {}) };
    nextTimestamps[label] = completed ? new Date().toISOString() : '';
    order.trackingTimestamps = nextTimestamps;
    if (completed && stepKey === 'delivery') {
      order.atelierStatus = 'delivered';
      order.customOrderStatus = 'delivered';
      order.orderStatus = 'delivered';
      order.deliveryStatus = 'Delivered';
    } else if (completed) {
      order.atelierStatus = stepKey === 'finishing' ? 'ready' : 'stitching';
      order.customOrderStatus = stepKey === 'finishing' ? 'ready' : 'in_stitching';
      order.orderStatus = 'processing';
    }
    await order.save();

    return res.status(200).json({
      success: true,
      data: toPublicOrder(order),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getCatalog,
  getQuote,
  saveMeasurementProfile,
  listMyAtelierOrders,
  getAtelierOrderTracking,
  updateAtelierTracking,
};
