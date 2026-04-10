const mongoose = require('mongoose');

const Order = require('../models/Order');
const Store = require('../models/Store');
const CustomOrderMessage = require('../models/CustomOrderMessage');
const VendorTrainingProgress = require('../models/VendorTrainingProgress');
const VendorSampleReview = require('../models/VendorSampleReview');

const ALLOWED_SPECIALIZATIONS = new Set([
  'shirts',
  'blazers',
  'dresses',
  'ethnic wear',
  'ethnic_wear',
  'kurtas',
  'gowns',
  'blouses',
  'suits',
]);

const CUSTOM_VENDOR_STATUSES = [
  'new_order',
  'accepted',
  'needs_clarification',
  'in_stitching',
  'quality_check',
  'ready',
  'shipped',
  'delivered',
  'rejected',
];

const DEFAULT_TRAINING_MODULES = [
  { key: 'measurement_guidelines', title: 'Measurement Guidelines' },
  { key: 'stitching_standards', title: 'Stitching Standards' },
  { key: 'quality_checklist', title: 'Quality Checklist' },
];

function ensureVendor(req, res) {
  if (!req.user?.uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  return true;
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

function normalizeVendorSpecializations(items) {
  const normalized = Array.isArray(items)
    ? items
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => ALLOWED_SPECIALIZATIONS.has(item))
    : [];
  return Array.from(new Set(normalized)).slice(0, 8);
}

function clampNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, numeric));
}

function createDefaultTrainingModules() {
  return DEFAULT_TRAINING_MODULES.map((module) => ({
    ...module,
    status: 'pending',
    completedAt: '',
    score: 0,
  }));
}

function serializeTrainingProgress(progress) {
  const source = progress?.toObject?.() || progress || {};
  const modules = Array.isArray(source.modules) && source.modules.length > 0
    ? source.modules
    : createDefaultTrainingModules();
  return {
    trainingStatus: source.trainingStatus || 'not_started',
    lastUpdatedAt: source.lastUpdatedAt || '',
    modules: modules.map((module) => ({
      key: module.key || '',
      title: module.title || '',
      status: module.status || 'pending',
      completedAt: module.completedAt || '',
      score: Number(module.score || 0),
    })),
  };
}

function serializeSampleReview(review) {
  const source = review?.toObject?.() || review || {};
  return {
    id: source._id?.toString?.() || '',
    sampleImages: Array.isArray(source.sampleImages) ? source.sampleImages : [],
    notes: source.notes || '',
    status: source.status || 'pending_review',
    reviewedBy: source.reviewedBy || '',
    reviewedAt: source.reviewedAt || '',
    adminFeedback: source.adminFeedback || '',
    createdAt: source.createdAt || '',
    updatedAt: source.updatedAt || '',
  };
}

function averageOf(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function qualityTierForScore(score) {
  if (score >= 90) return 'elite';
  if (score >= 75) return 'trusted';
  if (score >= 60) return 'watchlist';
  return 'risk';
}

function computeQualityState({ store, orders, trainingProgress, sampleReview }) {
  const profile = store?.customVendorProfile || {};
  const metrics = profile.metrics || {};
  const storedQuality = profile.quality || {};
  const deliveredOrders = (orders || []).filter(
    (order) => order.customOrderStatus === 'delivered'
  );
  const fitRatedOrders = deliveredOrders.filter(
    (order) => Number(order.customerFitRating || 0) > 0
  );
  const fitSuccessRate = fitRatedOrders.length === 0
    ? Number(storedQuality.fitSuccessRate || 0)
    : fitRatedOrders.filter((order) => Number(order.customerFitRating || 0) >= 4).length / fitRatedOrders.length;
  const onTimeDeliveryRate = 1 - Math.min(1, Math.max(0, Number(metrics.delayRate || 0)));
  const returnRate = Math.min(1, Math.max(0, Number(metrics.returnRate || 0)));
  const alterationRate = deliveredOrders.length === 0
    ? 0
    : deliveredOrders.filter((order) => order.alterationStatus && order.alterationStatus !== 'none').length / deliveredOrders.length;
  const customerQualityRating = fitRatedOrders.length === 0
    ? Number(storedQuality.customerQualityRating || 0)
    : averageOf(fitRatedOrders.map((order) => order.customerQualityRating));
  const customerFitRating = fitRatedOrders.length === 0
    ? Number(storedQuality.customerFitRating || 0)
    : averageOf(fitRatedOrders.map((order) => order.customerFitRating));
  const customerDeliveryRating = fitRatedOrders.length === 0
    ? Number(storedQuality.customerDeliveryRating || 0)
    : averageOf(fitRatedOrders.map((order) => order.customerDeliveryRating));
  const adminQaPassRate = sampleReview?.status === 'approved' ? 1 : Number(storedQuality.adminQaPassRate || 0);
  const score = (
    fitSuccessRate * 30 +
    onTimeDeliveryRate * 20 +
    (1 - returnRate) * 15 +
    (customerQualityRating / 5) * 15 +
    (1 - alterationRate) * 10 +
    adminQaPassRate * 10
  );
  const qualityScore = Math.max(0, Math.min(100, Number(score.toFixed(1))));
  const completedModules = (trainingProgress?.modules || []).filter((module) => module.status === 'completed').length;
  const trainingCompletion = DEFAULT_TRAINING_MODULES.length == 0
    ? 0
    : completedModules / DEFAULT_TRAINING_MODULES.length;
  return {
    qualityScore,
    fitSuccessRate,
    onTimeDeliveryRate,
    returnRate,
    alterationRate,
    customerQualityRating,
    customerFitRating,
    customerDeliveryRating,
    adminQaPassRate,
    visibilityTier: qualityTierForScore(qualityScore),
    trainingCompletionRate: Number(trainingCompletion.toFixed(2)),
    trainingStatus: trainingProgress?.trainingStatus || 'not_started',
    sampleApprovalStatus: sampleReview?.status || 'pending_review',
  };
}

function serializeCustomVendorProfile(store) {
  const profile = store?.customVendorProfile || {};
  const metrics = profile.metrics || {};
  const quality = profile.quality || {};
  return {
    vendorType: store?.vendorType || 'standard_vendor',
    experienceYears: Number(profile.experienceYears || 0),
    specializations: Array.isArray(profile.specializations) ? profile.specializations : [],
    portfolioImages: Array.isArray(profile.portfolioImages) ? profile.portfolioImages : [],
    priceRangeMin: Number(profile.priceRangeMin || 0),
    priceRangeMax: Number(profile.priceRangeMax || 0),
    productionTimeDays: Number(profile.productionTimeDays || 0),
    qualityApprovalRequired: Boolean(profile.qualityApprovalRequired),
    supportsAlterations: Boolean(profile.supportsAlterations),
    alterationPolicy: profile.alterationPolicy || '',
    qualityTier: profile.qualityTier || 'normal',
    penaltyPoints: Number(profile.penaltyPoints || 0),
    activeCustomOrderLimit: Number(profile.activeCustomOrderLimit || 0),
    metrics: {
      orderSuccessRate: Number(metrics.orderSuccessRate || 0),
      delayRate: Number(metrics.delayRate || 0),
      returnRate: Number(metrics.returnRate || 0),
      totalCustomOrders: Number(metrics.totalCustomOrders || 0),
      completedCustomOrders: Number(metrics.completedCustomOrders || 0),
    },
    quality: {
      qualityScore: Number(quality.qualityScore || 0),
      fitSuccessRate: Number(quality.fitSuccessRate || 0),
      onTimeDeliveryRate: Number(quality.onTimeDeliveryRate || 0),
      customerQualityRating: Number(quality.customerQualityRating || 0),
      customerFitRating: Number(quality.customerFitRating || 0),
      customerDeliveryRating: Number(quality.customerDeliveryRating || 0),
      adminQaPassRate: Number(quality.adminQaPassRate || 0),
      visibilityTier: quality.visibilityTier || 'watchlist',
    },
  };
}

function serializeCustomOrder(order) {
  const source = typeof order.toObject === 'function' ? order.toObject() : order;
  return {
    id: source._id?.toString() || '',
    storeId: source.storeId?.toString?.() || '',
    userId: source.userId || '',
    totalAmount: Number(source.totalAmount || 0),
    paymentStatus: source.paymentStatus || 'pending',
    escrowStatus: source.escrowStatus || 'held',
    orderStatus: source.orderStatus || 'pending',
    fulfillmentType: source.fulfillmentType || 'marketplace',
    customOrderStatus: source.customOrderStatus || 'none',
    selectedDesignerName: source.selectedDesignerName || '',
    customMeasurements: source.customMeasurements || {},
    customDesignOptions: source.customDesignOptions || {},
    referenceImageUrl: source.referenceImageUrl || '',
    previewImageUrl: source.previewImageUrl || '',
    vendorFinalImageUrl: source.vendorFinalImageUrl || '',
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
    shippingLabel: source.shippingAddress?.name || '',
    shippingAddress: [
      source.shippingAddress?.addressLine1 || '',
      source.shippingAddress?.addressLine2 || '',
      source.shippingAddress?.city || '',
      source.shippingAddress?.state || '',
      source.shippingAddress?.pincode || '',
    ].where(Boolean).join(', '),
    items: Array.isArray(source.items)
      ? source.items.map((item) => ({
          productId: item.productId?.toString?.() || '',
          name: item.name || '',
          quantity: Number(item.quantity || 1),
          price: Number(item.price || 0),
          size: item.size || '',
          image: item.image || '',
        }))
      : [],
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

async function getOwnCustomVendorProfile(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    return res.status(200).json({
      success: true,
      data: {
        storeId: store._id.toString(),
        storeName: store.name,
        profile: serializeCustomVendorProfile(store),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getOwnCustomVendorQuality(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const [trainingProgress, sampleReview, orders] = await Promise.all([
      VendorTrainingProgress.findOne({ vendorId: req.user.uid, storeId: store._id }),
      VendorSampleReview.findOne({ vendorId: req.user.uid, storeId: store._id }).sort({ createdAt: -1, _id: -1 }),
      Order.find({ storeId: store._id, fulfillmentType: 'custom_tailoring' }).sort({ createdAt: -1, _id: -1 }),
    ]);
    const quality = computeQualityState({
      store,
      orders,
      trainingProgress,
      sampleReview,
    });
    store.customVendorProfile = {
      ...(store.customVendorProfile?.toObject?.() || {}),
      qualityTier: quality.visibilityTier === 'risk' ? 'restricted' : store.customVendorProfile?.qualityTier || 'normal',
      quality: {
        ...(store.customVendorProfile?.quality?.toObject?.() || {}),
        qualityScore: quality.qualityScore,
        fitSuccessRate: quality.fitSuccessRate,
        onTimeDeliveryRate: quality.onTimeDeliveryRate,
        customerQualityRating: quality.customerQualityRating,
        customerFitRating: quality.customerFitRating,
        customerDeliveryRating: quality.customerDeliveryRating,
        adminQaPassRate: quality.adminQaPassRate,
        visibilityTier: quality.visibilityTier,
      },
    };
    await store.save();
    return res.status(200).json({
      success: true,
      data: {
        storeId: store._id.toString(),
        profile: serializeCustomVendorProfile(store),
        training: serializeTrainingProgress(trainingProgress),
        sampleReview: serializeSampleReview(sampleReview),
        quality,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveOwnCustomVendorProfile(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const body = req.body || {};
    const profile = store.customVendorProfile || {};
    const specializations = normalizeVendorSpecializations(body.specializations);
    const portfolioImages = Array.isArray(body.portfolioImages)
      ? body.portfolioImages
          .map(normalizeOptionalUrl)
          .filter(Boolean)
          .slice(0, 10)
      : (Array.isArray(profile.portfolioImages) ? profile.portfolioImages : []);
    const alterationPolicy =
      typeof body.alterationPolicy === 'string'
        ? body.alterationPolicy.trim().slice(0, 280)
        : profile.alterationPolicy || '';
    store.vendorType = 'custom_vendor';
    store.customVendorProfile = {
      ...profile.toObject?.(),
      experienceYears: clampNumber(body.experienceYears, Number(profile.experienceYears || 0), 0, 60),
      specializations: specializations.length > 0 ? specializations : profile.specializations || [],
      portfolioImages,
      priceRangeMin: clampNumber(body.priceRangeMin, Number(profile.priceRangeMin || 0), 0, 1000000),
      priceRangeMax: clampNumber(body.priceRangeMax, Number(profile.priceRangeMax || 0), 0, 1000000),
      productionTimeDays: clampNumber(body.productionTimeDays, Number(profile.productionTimeDays || 7), 1, 365),
      qualityApprovalRequired:
        typeof body.qualityApprovalRequired === 'boolean'
          ? body.qualityApprovalRequired
          : Boolean(profile.qualityApprovalRequired),
      supportsAlterations:
        typeof body.supportsAlterations === 'boolean'
          ? body.supportsAlterations
          : profile.supportsAlterations !== false,
      alterationPolicy,
      qualityTier: profile.qualityTier || 'normal',
      penaltyPoints: Number(profile.penaltyPoints || 0),
      activeCustomOrderLimit: Number(profile.activeCustomOrderLimit || 0),
      metrics: profile.metrics || {},
      quality: profile.quality || {},
    };
    await store.save();
    return res.status(200).json({
      success: true,
      data: {
        storeId: store._id.toString(),
        storeName: store.name,
        profile: serializeCustomVendorProfile(store),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function completeTrainingModule(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const moduleKey = String(req.params?.moduleKey || '').trim().toLowerCase();
    const definition = DEFAULT_TRAINING_MODULES.find((module) => module.key === moduleKey);
    if (!definition) {
      return res.status(400).json({ success: false, message: 'Invalid training module.' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const quizScore = Math.max(0, Math.min(100, Number(req.body?.score || 100)));
    const progress = await VendorTrainingProgress.findOneAndUpdate(
      { vendorId: req.user.uid, storeId: store._id },
      {
        $setOnInsert: {
          vendorId: req.user.uid,
          storeId: store._id,
          vendorType: 'custom_vendor',
          modules: createDefaultTrainingModules(),
        },
      },
      { new: true, upsert: true }
    );
    const modules = Array.isArray(progress.modules) && progress.modules.length > 0
      ? progress.modules
      : createDefaultTrainingModules();
    progress.modules = modules.map((module) => {
      if (module.key !== moduleKey) {
        return module;
      }
      return {
        ...module.toObject?.(),
        key: definition.key,
        title: definition.title,
        status: 'completed',
        completedAt: new Date().toISOString(),
        score: quizScore,
      };
    });
    const completedModules = progress.modules.filter((module) => module.status === 'completed').length;
    progress.trainingStatus = completedModules == 0
      ? 'not_started'
      : completedModules === DEFAULT_TRAINING_MODULES.length
          ? 'completed'
          : 'in_progress';
    progress.lastUpdatedAt = new Date().toISOString();
    await progress.save();
    return res.status(200).json({
      success: true,
      data: serializeTrainingProgress(progress),
    });
  } catch (error) {
    return next(error);
  }
}

async function submitSampleReview(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const sampleImages = Array.isArray(req.body?.sampleImages)
      ? req.body.sampleImages
          .map(normalizeOptionalUrl)
          .filter(Boolean)
          .slice(0, 10)
      : [];
    if (sampleImages.length == 0) {
      return res.status(400).json({ success: false, message: 'Upload at least one sample image.' });
    }
    if (sampleImages.length < 3) {
      return res.status(400).json({ success: false, message: 'Upload at least three valid sample images.' });
    }
    const review = await VendorSampleReview.create({
      vendorId: req.user.uid,
      storeId: store._id,
      sampleImages,
      notes: typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 500) : '',
      status: 'pending_review',
    });
    return res.status(201).json({
      success: true,
      data: serializeSampleReview(review),
    });
  } catch (error) {
    return next(error);
  }
}

async function getCustomVendorDashboard(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const orders = await Order.find({
      storeId: store._id,
      fulfillmentType: 'custom_tailoring',
    }).sort({ createdAt: -1, _id: -1 });
    const counts = Object.fromEntries(CUSTOM_VENDOR_STATUSES.map((status) => [status, 0]));
    for (const order of orders) {
      const key = order.customOrderStatus || 'new_order';
      if (counts[key] != null) {
        counts[key] += 1;
      }
    }
    return res.status(200).json({
      success: true,
      data: {
        storeId: store._id.toString(),
        profile: serializeCustomVendorProfile(store),
        metrics: {
          totalCustomOrders: orders.length,
          newOrders: counts.new_order,
          accepted: counts.accepted,
          inStitching: counts.in_stitching,
          qualityCheck: counts.quality_check,
          ready: counts.ready,
          shipped: counts.shipped,
          delivered: counts.delivered,
        },
        orders: orders.map(serializeCustomOrder),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listCustomVendorOrders(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const status = String(req.query?.status || '').trim().toLowerCase();
    const query = {
      storeId: store._id,
      fulfillmentType: 'custom_tailoring',
    };
    if (status) {
      query.customOrderStatus = status;
    }
    const orders = await Order.find(query).sort({ createdAt: -1, _id: -1 });
    return res.status(200).json({
      success: true,
      data: orders.map(serializeCustomOrder),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCustomOrderStatus(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const orderId = String(req.params?.orderId || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    if (!CUSTOM_VENDOR_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid custom order status.' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const order = await Order.findOne({
      _id: orderId,
      storeId: store._id,
      fulfillmentType: 'custom_tailoring',
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Custom order not found.' });
    }
    if (typeof req.body?.vendorFinalImageUrl === 'string') {
      order.vendorFinalImageUrl = req.body.vendorFinalImageUrl.trim();
    }
    if (typeof req.body?.qualityApprovalStatus === 'string') {
      order.qualityApprovalStatus = req.body.qualityApprovalStatus.trim().toLowerCase();
    }
    if (typeof req.body?.measurementsConfirmedByVendor === 'boolean') {
      order.measurementsConfirmedByVendor = req.body.measurementsConfirmedByVendor;
    }
    if (typeof req.body?.alterationStatus === 'string') {
      order.alterationStatus = req.body.alterationStatus.trim().toLowerCase();
      if (
        order.alterationStatus === 'completed' ||
        order.alterationStatus === 'rejected'
      ) {
        order.alterationResolvedAt = new Date().toISOString();
      }
    }

    const requiresPreDispatchProof =
      status === 'ready' || status === 'shipped' || status === 'delivered';
    if (requiresPreDispatchProof) {
      if (!order.vendorFinalImageUrl.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Upload the final product image before dispatch.',
        });
      }
      if (!order.measurementsConfirmedByVendor) {
        return res.status(400).json({
          success: false,
          message: 'Confirm measurements were followed before dispatch.',
        });
      }
      order.preDispatchChecklistCompletedAt =
        order.preDispatchChecklistCompletedAt || new Date().toISOString();
    }

    if (
      status === 'shipped' &&
      store.customVendorProfile?.qualityApprovalRequired &&
      order.qualityApprovalStatus !== 'approved'
    ) {
      order.qualityApprovalStatus = 'pending';
      return res.status(400).json({
        success: false,
        message: 'Admin approval is required before shipping this custom order.',
        data: serializeCustomOrder(order),
      });
    }

    order.customOrderStatus = status;
    if (status === 'delivered') {
      order.orderStatus = 'delivered';
      if (order.customerFitFeedbackStatus === 'pending') {
        order.customerFitFeedbackStatus = 'pending';
      }
    } else if (status === 'shipped') {
      order.orderStatus = 'shipped';
    } else if (status === 'accepted' || status === 'in_stitching' || status === 'quality_check') {
      order.orderStatus = 'processing';
    }
    await order.save();
    return res.status(200).json({ success: true, data: serializeCustomOrder(order) });
  } catch (error) {
    return next(error);
  }
}

async function listCustomOrderMessages(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const messages = await CustomOrderMessage.find({
      orderId,
      storeId: store._id,
    }).sort({ createdAt: 1, _id: 1 });
    return res.status(200).json({
      success: true,
      data: messages.map((item) => ({
        id: item._id.toString(),
        orderId: item.orderId.toString(),
        senderId: item.senderId,
        senderRole: item.senderRole,
        message: item.message,
        attachments: item.attachments,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  completeTrainingModule,
  getCustomVendorDashboard,
  getOwnCustomVendorProfile,
  getOwnCustomVendorQuality,
  listCustomOrderMessages,
  listCustomVendorOrders,
  saveOwnCustomVendorProfile,
  submitSampleReview,
  updateCustomOrderStatus,
};
