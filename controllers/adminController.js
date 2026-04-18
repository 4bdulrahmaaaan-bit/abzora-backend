const crypto = require('crypto');

const User = require('../models/User');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Order = require('../models/Order');
const SupportChat = require('../models/SupportChat');
const TrialHomeSession = require('../models/TrialHomeSession');
const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');
const AdminPlatformSettings = require('../models/AdminPlatformSettings');
const AdminNotification = require('../models/AdminNotification');
const AdminPayout = require('../models/AdminPayout');
const AdminDispute = require('../models/AdminDispute');
const AdminActivityLog = require('../models/AdminActivityLog');
const { isAllowedAdminEmail } = require('./authController');
const { settleVendorWallet } = require('../services/financeService');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function toIsoNow() {
  return new Date().toISOString();
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBooleanMap(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, enabled]) => [String(key || '').trim(), Boolean(enabled)])
      .filter(([key]) => key),
  );
}

function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return [...new Set(
    value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, 20),
  )];
}

function normalizeAdminPin(value) {
  const pin = String(value || '').trim();
  if (!pin) {
    return null;
  }
  if (!/^\d{4,12}$/.test(pin)) {
    throw new Error('Admin PIN must be 4 to 12 digits.');
  }
  return pin;
}

function hashAdminPin(pin) {
  return crypto.createHash('sha256').update(`abzio-admin-pin:${pin}`).digest('hex');
}

function serializeVendorKyc(item) {
  return {
    id: item.requestId,
    userId: item.userId,
    storeName: item.storeName,
    ownerName: item.ownerName,
    phone: item.phone,
    address: item.address,
    city: item.city,
    latitude: Number(item.latitude || 0),
    longitude: Number(item.longitude || 0),
    kyc: item.kyc || {},
    status: item.status,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    rejectionReason: item.rejectionReason || '',
    reviewedBy: item.reviewedBy || '',
    reviewedByName: item.reviewedByName || '',
    reviewedAt: item.reviewedAt || '',
    actionHistory: item.actionHistory || [],
    verification: item.verification || {},
  };
}

function serializeRiderKyc(item) {
  return {
    id: item.requestId,
    userId: item.userId,
    name: item.name,
    phone: item.phone,
    vehicle: item.vehicle,
    city: item.city,
    kyc: item.kyc || {},
    status: item.status,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    rejectionReason: item.rejectionReason || '',
    reviewedBy: item.reviewedBy || '',
    reviewedByName: item.reviewedByName || '',
    reviewedAt: item.reviewedAt || '',
    actionHistory: item.actionHistory || [],
  };
}

function serializeUser(user) {
  return {
    id: user._id?.toString?.() || '',
    firebaseUid: user.firebaseUid || user.uid || '',
    uid: user.firebaseUid || user.uid || '',
    phone: user.phone || '',
    email: user.email || '',
    name: user.name || 'ABZORA Member',
    role: user.role || 'customer',
    roles: user.roles || {},
    isActive: user.isActive !== false,
    storeId: user.storeId || '',
    walletBalance: Number(user.walletBalance || 0),
    riderApprovalStatus: user.riderApprovalStatus || 'pending',
    riderVehicleType: user.riderVehicleType || '',
    riderLicenseNumber: user.riderLicenseNumber || '',
    riderCity: user.riderCity || '',
    profileImageUrl: user.profileImageUrl || '',
    address: user.address || '',
    area: user.area || '',
    city: user.city || '',
    latitude: user.latitude ?? null,
    longitude: user.longitude ?? null,
    deliveryRadiusKm: Number(user.deliveryRadiusKm || 10),
    locationUpdatedAt: user.locationUpdatedAt || '',
    createdAt: user.createdAt?.toISOString?.() || '',
    updatedAt: user.updatedAt?.toISOString?.() || '',
  };
}

function serializeStore(item) {
  return {
    id: item._id?.toString?.() || '',
    vendorId: item.vendorId?._id?.toString?.() || item.vendorId?.toString?.() || '',
    name: item.name || '',
    description: item.description || '',
    rating: Number(item.rating || 0),
    logoUrl: item.logoUrl || '',
    ownerId: item.ownerId || '',
    isActive: item.isActive !== false,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    commissionRate: Number(item.commissionRate || 0.12),
    walletBalance: Number(item.walletBalance || 0),
  };
}

function serializeProduct(item) {
  return {
    id: item._id?.toString?.() || '',
    name: item.name || '',
    price: Number(item.price || 0),
    description: item.description || '',
    stock: Number(item.stock || 0),
    category: item.category || '',
    subcategory: item.subcategory || '',
    model3d: item.model3d || '',
    arAsset: item.arAsset || {},
    attributes: item.attributes ? Object.fromEntries(Object.entries(item.attributes)) : {},
    images: item.images || [],
    storeId: item.storeId?._id?.toString?.() || item.storeId?.toString?.() || '',
    store: item.storeId && typeof item.storeId === 'object'
      ? {
          id: item.storeId._id?.toString?.() || '',
          name: item.storeId.name || '',
          rating: Number(item.storeId.rating || 0),
          logoUrl: item.storeId.logoUrl || '',
        }
      : null,
    isActive: item.isActive !== false,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

function serializeOrder(item) {
  return {
    id: item._id?.toString?.() || '',
    userId: item.userId || '',
    storeId: item.storeId?._id?.toString?.() || item.storeId?.toString?.() || '',
    riderId: item.riderId || '',
    items: Array.isArray(item.items)
      ? item.items.map((entry) => ({
          productId: entry.productId?.toString?.() || '',
          name: entry.name || '',
          price: Number(entry.price || 0),
          quantity: Number(entry.quantity || 0),
          image: entry.image || '',
        }))
      : [],
    subtotalAmount: Number(item.subtotalAmount || 0),
    totalAmount: Number(item.totalAmount || 0),
    paymentMethod: item.paymentMethod || '',
    paymentStatus: item.paymentStatus || '',
    orderStatus: item.orderStatus || '',
    deliveryStatus: item.deliveryStatus || 'Pending',
    assignedDeliveryPartner: item.assignedDeliveryPartner || 'Unassigned',
    riderLatitude: item.riderLatitude ?? null,
    riderLongitude: item.riderLongitude ?? null,
    riderLocationUpdatedAt: item.riderLocationUpdatedAt || '',
    shippingAddress: item.shippingAddress || {},
    razorpay: item.razorpay || {},
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

function serializeSettings(item) {
  const cities = item?.cities instanceof Map ? Object.fromEntries(item.cities.entries()) : (item?.cities || {});
  const regions = item?.regionVendorAvailability instanceof Map
    ? Object.fromEntries(item.regionVendorAvailability.entries())
    : (item?.regionVendorAvailability || {});
  return {
    customTailoringEnabled: item?.customTailoringEnabled ?? true,
    reelsEnabled: item?.reelsEnabled ?? true,
    offersEnabled: item?.offersEnabled ?? true,
    checkoutEnabled: item?.checkoutEnabled ?? true,
    marketplaceEnabled: item?.marketplaceEnabled ?? true,
    riderDispatchEnabled: item?.riderDispatchEnabled ?? true,
    cities,
    regionVendorAvailability: regions,
    allowedAdminDevices: item?.allowedAdminDevices || ['web-chrome', 'windows-desktop'],
    adminIdleTimeoutMinutes: Number(item?.adminIdleTimeoutMinutes || 10),
    adminPinEnabled: item?.adminPinEnabled ?? false,
    adminPinConfigured: Boolean(item?.adminPin),
    aiDailyCostAlertThreshold: Number(item?.aiDailyCostAlertThreshold || 1.0),
    aiDailyCostLimit: Number(item?.aiDailyCostLimit || 500),
    aiAssistantEnabled: item?.aiAssistantEnabled ?? true,
    trialHomeEnabled: item?.trialHomeEnabled ?? true,
    trialHomeFraudDetectionEnabled: item?.trialHomeFraudDetectionEnabled ?? true,
    trialHomeMinUserScore: Number(item?.trialHomeMinUserScore || 45),
    trialHomeMaxRiskScore: Number(item?.trialHomeMaxRiskScore || 80),
  };
}

function serializeNotification(item) {
  return {
    id: item.notificationId,
    title: item.title || '',
    body: item.body || '',
    type: item.type || 'general',
    isRead: item.isRead === true,
    timestamp: item.timestamp || toIsoNow(),
    audienceRole: item.audienceRole || 'user',
    userId: item.userId || null,
    storeId: item.storeId || null,
  };
}

function serializePayout(item) {
  return {
    id: item.payoutId,
    storeId: item.storeId || '',
    processedBy: item.processedBy || '',
    amount: Number(item.amount || 0),
    periodLabel: item.periodLabel || '',
    createdAt: item.createdAtIso || item.createdAt?.toISOString?.() || '',
    orderIds: item.orderIds || [],
    status: item.status || 'Processed',
  };
}

function serializeDispute(item) {
  return {
    id: item.disputeId,
    orderId: item.orderId || '',
    userId: item.userId || '',
    storeId: item.storeId || '',
    type: item.type || 'Dispute',
    status: item.status || 'Open',
    amount: Number(item.amount || 0),
    reason: item.reason || '',
    createdAt: item.createdAtIso || item.createdAt?.toISOString?.() || '',
  };
}

function serializeActivityLog(item) {
  return {
    id: item.logId,
    actorId: item.actorId || '',
    actorRole: item.actorRole || '',
    action: item.action || '',
    targetType: item.targetType || '',
    targetId: item.targetId || '',
    message: item.message || '',
    timestamp: item.timestampIso || item.createdAt?.toISOString?.() || '',
  };
}

function serializeTrialHomeSession(item) {
  return {
    id: item._id?.toString?.() || '',
    userId: item.userId || '',
    status: item.status || 'booked',
    approvalStatus: item.approvalStatus || 'approved',
    approvedBy: item.approvedBy || '',
    approvalReason: item.approvalReason || '',
    items: Array.isArray(item.items)
      ? item.items.map((entry) => ({
          productId: entry.productId || '',
          name: entry.name || '',
          imageUrl: entry.imageUrl || '',
          price: Number(entry.price || 0),
          recommendedSize: entry.recommendedSize || '',
          fitConfidence: Number(entry.fitConfidence || 0),
          styledForYou: entry.styledForYou === true,
          source: entry.source || 'selected',
        }))
      : [],
    recommendedItems: Array.isArray(item.recommendedItems)
      ? item.recommendedItems.map((entry) => ({
          productId: entry.productId || '',
          name: entry.name || '',
          imageUrl: entry.imageUrl || '',
          price: Number(entry.price || 0),
          recommendedSize: entry.recommendedSize || '',
          fitConfidence: Number(entry.fitConfidence || 0),
          styledForYou: entry.styledForYou === true,
          source: entry.source || 'styled',
        }))
      : [],
    addressLabel: item.addressLabel || '',
    deliverySlot: item.deliverySlot || '',
    deliveryWindowLabel: item.deliveryWindowLabel || '',
    experienceType: item.experienceType || 'premium',
    trialFee: Number(item.trialFee || 99),
    trialFeeRefundable: item.trialFeeRefundable !== false,
    paymentStatus: item.paymentStatus || 'pending',
    subtotal: Number(item.subtotal || 0),
    keptItems: item.keptItems || [],
    returnedItems: item.returnedItems || [],
    convertedOrderId: item.convertedOrderId || '',
    tailoringRequest: item.tailoringRequest || '',
    feedback: item.feedback || {},
    events: item.events || [],
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

async function findVendorUserByPublicId(publicUserId) {
  return User.findOne({
    $or: [
      { _id: publicUserId },
      { firebaseUid: publicUserId },
      { uid: publicUserId },
      { phone: publicUserId },
    ],
  });
}

async function ensureVendorStoreForUser(user, options = {}) {
  if (!user) {
    throw new Error('Vendor user is required.');
  }

  const existingStore = await Store.findOne({
    $or: [
      { vendorId: user._id },
      { ownerId: user.firebaseUid || user.uid || '' },
    ],
  });

  if (existingStore) {
    if (!existingStore.vendorId) {
      existingStore.vendorId = user._id;
      await existingStore.save();
    }
    if (!user.storeId || user.storeId !== existingStore._id.toString()) {
      user.storeId = existingStore._id.toString();
      await user.save();
    }
    return existingStore;
  }

  const store = await Store.create({
    vendorId: user._id,
    ownerId: user.firebaseUid || user.uid || user._id.toString(),
    name: String(options.storeName || user.name || 'My Store').trim() || 'My Store',
    description: String(options.description || '').trim(),
    isActive: true,
  });

  user.storeId = store._id.toString();
  await user.save();
  return store;
}

async function getOrCreateSettings() {
  let settings = await AdminPlatformSettings.findOne({ key: 'platform-settings' });
  if (!settings) {
    settings = await AdminPlatformSettings.create({ key: 'platform-settings' });
  }
  return settings;
}

async function getDashboardSummary(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const [
      usersCount,
      storesCount,
      productsCount,
      orders,
      openSupportChats,
      pendingVendorKyc,
      pendingRiderKyc,
    ] = await Promise.all([
      User.countDocuments({}),
      Store.countDocuments({}),
      Product.countDocuments({}),
      Order.find({}).sort({ createdAt: -1 }).limit(500),
      SupportChat.countDocuments({ status: { $ne: 'closed' } }),
      VendorKycRequest.countDocuments({ status: 'pending' }),
      RiderKycRequest.countDocuments({ status: 'pending' }),
    ]);

    const totalRevenue = orders
      .filter((order) => order.paymentStatus === 'paid')
      .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);

    const totalOrders = orders.length;
    const today = new Date();
    const ordersToday = orders.filter((order) => {
      const date = order.createdAt || null;
      return (
        date &&
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      );
    }).length;
    const commissionRevenue = orders
      .filter((order) => order.paymentStatus === 'paid')
      .reduce((sum, order) => sum + Number(order.platformCommission || 0), 0);
    const vendorPayouts = await AdminPayout.find({}).sort({ createdAt: -1, _id: -1 }).limit(200);
    const vendorPayoutTotal = vendorPayouts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const riderPayoutTotal = orders
      .filter((order) => String(order.riderPayoutStatus || '').toLowerCase() === 'processed')
      .reduce((sum, order) => sum + Number(order.riderEarnings || 0), 0);
    const delivered = orders.filter((order) => order.orderStatus === 'delivered');
    const salesByStore = new Map();
    for (const order of delivered) {
      const key = order.storeId?.toString() || '';
      salesByStore.set(key, Number(salesByStore.get(key) || 0) + Number(order.totalAmount || 0));
    }

    const stores = await Store.find({
      _id: { $in: Array.from(salesByStore.keys()).filter(Boolean) },
    });
    const topStores = stores
      .map((store) => ({
        id: store._id.toString(),
        name: store.name,
        rating: Number(store.rating || 0),
        logoUrl: store.logoUrl || '',
        revenue: Number(salesByStore.get(store._id.toString()) || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const dailySales = Array.from({ length: 7 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (6 - index));
      const value = delivered
        .filter((order) => {
          const date = order.updatedAt || order.createdAt;
          return (
            date &&
            date.getFullYear() === day.getFullYear() &&
            date.getMonth() === day.getMonth() &&
            date.getDate() === day.getDate()
          );
        })
        .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
      return {
        label: day.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        value,
      };
    });

    const weeklySales = Array.from({ length: 4 }, (_, index) => {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() - ((3 - index) * 7));
      const start = new Date(end);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);
      const value = delivered
        .filter((order) => {
          const date = order.updatedAt || order.createdAt;
          return date && date >= start && date <= end;
        })
        .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
      return { label: `W${index + 1}`, value };
    });

    return res.status(200).json({
      success: true,
      data: {
        usersCount,
        storesCount,
        productsCount,
        totalOrders,
        ordersToday,
        totalRevenue,
        platformCommissionRevenue: commissionRevenue,
        vendorPayouts: vendorPayoutTotal,
        riderPayouts: riderPayoutTotal,
        openSupportChats,
        pendingVendorKyc,
        pendingRiderKyc,
        topStores,
        dailySales,
        weeklySales,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const users = await User.find({}).sort({ createdAt: -1, _id: -1 }).limit(500);
    return res.status(200).json({
      success: true,
      data: users.map(serializeUser),
    });
  } catch (error) {
    return next(error);
  }
}

async function listStores(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const stores = await Store.find({}).sort({ createdAt: -1, _id: -1 }).limit(500);
    return res.status(200).json({
      success: true,
      data: stores.map(serializeStore),
    });
  } catch (error) {
    return next(error);
  }
}

async function listProducts(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const products = await Product.find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .populate('storeId', 'name rating logoUrl');
    return res.status(200).json({
      success: true,
      data: products.map(serializeProduct),
    });
  } catch (error) {
    return next(error);
  }
}

async function listOrders(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const orders = await Order.find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .populate('storeId', 'name rating logoUrl');
    return res.status(200).json({
      success: true,
      data: orders.map(serializeOrder),
    });
  } catch (error) {
    return next(error);
  }
}

async function listVendorKycRequests(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const status = String(req.query.status || '').trim();
    const filter = status ? { status } : {};
    const items = await VendorKycRequest.find(filter).sort({ updatedAt: -1, _id: -1 });
    return res.status(200).json({
      success: true,
      data: items.map(serializeVendorKyc),
    });
  } catch (error) {
    return next(error);
  }
}

async function listRiderKycRequests(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const status = String(req.query.status || '').trim();
    const filter = status ? { status } : {};
    const items = await RiderKycRequest.find(filter).sort({ updatedAt: -1, _id: -1 });
    return res.status(200).json({
      success: true,
      data: items.map(serializeRiderKyc),
    });
  } catch (error) {
    return next(error);
  }
}

async function getPlatformSettings(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const settings = await getOrCreateSettings();
    return res.status(200).json({ success: true, data: serializeSettings(settings) });
  } catch (error) {
    return next(error);
  }
}

async function savePlatformSettings(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const settings = await getOrCreateSettings();
    const nextPin = Object.prototype.hasOwnProperty.call(req.body || {}, 'adminPin')
      ? normalizeAdminPin(req.body?.adminPin)
      : null;

    Object.assign(settings, {
      customTailoringEnabled: req.body?.customTailoringEnabled ?? settings.customTailoringEnabled,
      reelsEnabled: req.body?.reelsEnabled ?? settings.reelsEnabled,
      offersEnabled: req.body?.offersEnabled ?? settings.offersEnabled,
      checkoutEnabled: req.body?.checkoutEnabled ?? settings.checkoutEnabled,
      marketplaceEnabled: req.body?.marketplaceEnabled ?? settings.marketplaceEnabled,
      riderDispatchEnabled: req.body?.riderDispatchEnabled ?? settings.riderDispatchEnabled,
      cities: normalizeBooleanMap(req.body?.cities, settings.cities),
      regionVendorAvailability: normalizeBooleanMap(
        req.body?.regionVendorAvailability,
        settings.regionVendorAvailability,
      ),
      allowedAdminDevices: normalizeStringList(req.body?.allowedAdminDevices, settings.allowedAdminDevices),
      adminIdleTimeoutMinutes: clampNumber(
        req.body?.adminIdleTimeoutMinutes,
        settings.adminIdleTimeoutMinutes,
        1,
        120,
      ),
      adminPinEnabled: req.body?.adminPinEnabled ?? settings.adminPinEnabled,
      adminPin: nextPin ? hashAdminPin(nextPin) : settings.adminPin,
      aiDailyCostAlertThreshold: clampNumber(
        req.body?.aiDailyCostAlertThreshold,
        settings.aiDailyCostAlertThreshold,
        0,
        100000,
      ),
      aiDailyCostLimit: clampNumber(
        req.body?.aiDailyCostLimit,
        settings.aiDailyCostLimit,
        0,
        1000000,
      ),
      aiAssistantEnabled: req.body?.aiAssistantEnabled ?? settings.aiAssistantEnabled,
      trialHomeEnabled: req.body?.trialHomeEnabled ?? settings.trialHomeEnabled,
      trialHomeFraudDetectionEnabled:
        req.body?.trialHomeFraudDetectionEnabled ?? settings.trialHomeFraudDetectionEnabled,
      trialHomeMinUserScore: clampNumber(
        req.body?.trialHomeMinUserScore,
        settings.trialHomeMinUserScore,
        0,
        100,
      ),
      trialHomeMaxRiskScore: clampNumber(
        req.body?.trialHomeMaxRiskScore,
        settings.trialHomeMaxRiskScore,
        0,
        100,
      ),
    });
    await settings.save();
    return res.status(200).json({ success: true, data: serializeSettings(settings) });
  } catch (error) {
    return next(error);
  }
}

async function listNotifications(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const items = await AdminNotification.find({
      audienceRole: { $in: ['admin', 'all'] },
    }).sort({ createdAt: -1, _id: -1 }).limit(200);
    return res.status(200).json({ success: true, data: items.map(serializeNotification) });
  } catch (error) {
    return next(error);
  }
}

async function createNotification(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const notificationId = String(req.body?.id || `notif-${Date.now()}`).trim();
    const item = await AdminNotification.findOneAndUpdate(
      { notificationId },
      {
        notificationId,
        title: String(req.body?.title || '').trim(),
        body: String(req.body?.body || '').trim(),
        type: String(req.body?.type || 'general').trim(),
        isRead: Boolean(req.body?.isRead),
        timestamp: String(req.body?.timestamp || toIsoNow()).trim(),
        audienceRole: String(req.body?.audienceRole || 'user').trim(),
        userId: String(req.body?.userId || '').trim(),
        storeId: String(req.body?.storeId || '').trim(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, data: serializeNotification(item) });
  } catch (error) {
    return next(error);
  }
}

async function listPayouts(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const items = await AdminPayout.find({}).sort({ createdAt: -1, _id: -1 }).limit(200);
    return res.status(200).json({ success: true, data: items.map(serializePayout) });
  } catch (error) {
    return next(error);
  }
}

async function processPayout(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const storeId = String(req.body?.storeId || '').trim();
    const periodLabel = String(req.body?.periodLabel || 'Manual payout').trim();
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required.' });
    }

    const readyOrders = await Order.find({
      storeId,
      paymentStatus: 'paid',
      orderStatus: 'delivered',
      payoutStatus: 'pending',
    });
    if (readyOrders.length === 0) {
      return res.status(200).json({ success: true, data: null });
    }

    const payout = await settleVendorWallet({
      storeId,
      processedBy: req.user.uid,
      periodLabel,
      orders: readyOrders,
    });
    if (!payout) {
      return res.status(200).json({ success: true, data: null });
    }
    await Order.updateMany(
      { _id: { $in: readyOrders.map((order) => order._id) } },
      { $set: { payoutStatus: 'processed', payoutProcessed: true, payoutId: payout.payoutId } },
    );
    return res.status(200).json({ success: true, data: serializePayout(payout) });
  } catch (error) {
    return next(error);
  }
}

async function listDisputes(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const items = await AdminDispute.find({}).sort({ createdAt: -1, _id: -1 }).limit(200);
    return res.status(200).json({ success: true, data: items.map(serializeDispute) });
  } catch (error) {
    return next(error);
  }
}

async function updateDispute(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const disputeId = String(req.params.id || req.body?.id || '').trim();
    if (!disputeId) {
      return res.status(400).json({ success: false, message: 'Dispute id is required.' });
    }
    const item = await AdminDispute.findOneAndUpdate(
      { disputeId },
      {
        disputeId,
        orderId: String(req.body?.orderId || '').trim(),
        userId: String(req.body?.userId || '').trim(),
        storeId: String(req.body?.storeId || '').trim(),
        type: String(req.body?.type || 'Dispute').trim(),
        status: String(req.body?.status || 'Open').trim(),
        amount: Number(req.body?.amount || 0),
        reason: String(req.body?.reason || '').trim(),
        createdAtIso: String(req.body?.createdAt || toIsoNow()).trim(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, data: serializeDispute(item) });
  } catch (error) {
    return next(error);
  }
}

async function listActivityLogs(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const items = await AdminActivityLog.find({}).sort({ createdAt: -1, _id: -1 }).limit(300);
    return res.status(200).json({ success: true, data: items.map(serializeActivityLog) });
  } catch (error) {
    return next(error);
  }
}

async function createActivityLog(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const logId = String(req.body?.id || `log-${Date.now()}`).trim();
    const item = await AdminActivityLog.findOneAndUpdate(
      { logId },
      {
        logId,
        actorId: String(req.body?.actorId || req.user.uid || '').trim(),
        actorRole: String(req.body?.actorRole || req.user.role || 'admin').trim(),
        action: String(req.body?.action || '').trim(),
        targetType: String(req.body?.targetType || '').trim(),
        targetId: String(req.body?.targetId || '').trim(),
        message: String(req.body?.message || '').trim(),
        timestampIso: String(req.body?.timestamp || toIsoNow()).trim(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, data: serializeActivityLog(item) });
  } catch (error) {
    return next(error);
  }
}

async function reviewVendorKycRequest(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const requestId = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!requestId || !['approved', 'rejected', 'review'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Valid request id and status are required.' });
    }

    const item = await VendorKycRequest.findOne({ requestId });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Vendor KYC request not found.' });
    }

    item.status = status;
    item.rejectionReason = status === 'rejected' ? reason : '';
    item.reviewedBy = req.user.uid;
    item.reviewedByName = req.user.name || 'Admin';
    item.reviewedAt = toIsoNow();
    item.actionHistory = [
      ...(item.actionHistory || []),
      {
        actorId: req.user.uid,
        actorName: req.user.name || 'Admin',
        action: status,
        note: reason,
        timestamp: item.reviewedAt,
      },
    ];
    await item.save();

    let store = null;
    if (status === 'approved') {
      const user = await User.findOneAndUpdate(
        { $or: [{ firebaseUid: item.userId }, { uid: item.userId }] },
        {
          role: 'vendor',
          isActive: true,
          $set: {
            'roles.vendor': true,
          },
        },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ success: false, message: 'Vendor user not found.' });
      }

      store = await ensureVendorStoreForUser(user, {
        storeName: item.storeName || item.ownerName || user.name,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        kyc: serializeVendorKyc(item),
        store: store ? serializeStore(store) : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function approveVendor(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required.' });
    }

    const user = await findVendorUserByPublicId(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.role = 'vendor';
    user.isActive = true;
    user.roles = {
      ...(user.roles instanceof Map ? Object.fromEntries(user.roles.entries()) : (user.roles || {})),
      vendor: true,
    };
    await user.save();

    const vendorKycRequest = await VendorKycRequest.findOne({
      $or: [
        { userId: user.firebaseUid },
        { userId: user.uid },
        { userId },
      ],
    }).sort({ updatedAt: -1, _id: -1 });

    if (vendorKycRequest) {
      vendorKycRequest.status = 'approved';
      vendorKycRequest.rejectionReason = '';
      vendorKycRequest.reviewedBy = req.user.uid;
      vendorKycRequest.reviewedByName = req.user.name || 'Admin';
      vendorKycRequest.reviewedAt = toIsoNow();
      vendorKycRequest.actionHistory = [
        ...(vendorKycRequest.actionHistory || []),
        {
          actorId: req.user.uid,
          actorName: req.user.name || 'Admin',
          action: 'approved',
          note: 'Vendor approved via /admin/approve-vendor.',
          timestamp: vendorKycRequest.reviewedAt,
        },
      ];
      await vendorKycRequest.save();
    }

    const store = await ensureVendorStoreForUser(user, {
      storeName:
        vendorKycRequest?.storeName ||
        vendorKycRequest?.ownerName ||
        user.name ||
        'My Store',
    });

    return res.status(200).json({
      success: true,
      message: 'Vendor approved successfully.',
      data: {
        user: serializeUser(user),
        store: serializeStore(store),
        kyc: vendorKycRequest ? serializeVendorKyc(vendorKycRequest) : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function fixVendorStore(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const publicUserId = String(req.body?.userId || req.body?.phone || '').trim();
    if (!publicUserId) {
      return res.status(400).json({
        success: false,
        message: 'userId or phone is required.',
      });
    }

    const user = await findVendorUserByPublicId(publicUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Vendor user not found.' });
    }

    const vendorKycRequest = await VendorKycRequest.findOne({
      $or: [
        { userId: user.firebaseUid },
        { userId: user.uid },
        { phone: user.phone || '' },
        { userId: publicUserId },
      ],
    }).sort({ updatedAt: -1, _id: -1 });

    user.role = 'vendor';
    user.isActive = true;
    user.roles = {
      ...(user.roles instanceof Map ? Object.fromEntries(user.roles.entries()) : (user.roles || {})),
      vendor: true,
    };

    if (vendorKycRequest) {
      vendorKycRequest.status = 'approved';
      vendorKycRequest.rejectionReason = '';
      vendorKycRequest.reviewedBy = req.user.uid;
      vendorKycRequest.reviewedByName = req.user.name || 'Admin';
      vendorKycRequest.reviewedAt = toIsoNow();
      vendorKycRequest.actionHistory = [
        ...(vendorKycRequest.actionHistory || []),
        {
          actorId: req.user.uid,
          actorName: req.user.name || 'Admin',
          action: 'repair_store_link',
          note: 'Repaired missing vendor store link.',
          timestamp: vendorKycRequest.reviewedAt,
        },
      ];
      await vendorKycRequest.save();
    }

    await user.save();

    const store = await ensureVendorStoreForUser(user, {
      storeName:
        vendorKycRequest?.storeName ||
        vendorKycRequest?.ownerName ||
        user.name ||
        'My Store',
      description:
        vendorKycRequest?.address ||
        '',
    });

    if (!store.description && vendorKycRequest?.address) {
      store.description = vendorKycRequest.address;
      await store.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Vendor store repaired successfully.',
      data: {
        user: serializeUser(user),
        store: serializeStore(store),
        kyc: vendorKycRequest ? serializeVendorKyc(vendorKycRequest) : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function reviewRiderKycRequest(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const requestId = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!requestId || !['approved', 'rejected', 'review'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Valid request id and status are required.' });
    }

    const item = await RiderKycRequest.findOne({ requestId });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Rider KYC request not found.' });
    }

    item.status = status;
    item.rejectionReason = status === 'rejected' ? reason : '';
    item.reviewedBy = req.user.uid;
    item.reviewedByName = req.user.name || 'Admin';
    item.reviewedAt = toIsoNow();
    item.actionHistory = [
      ...(item.actionHistory || []),
      {
        actorId: req.user.uid,
        actorName: req.user.name || 'Admin',
        action: status,
        note: reason,
        timestamp: item.reviewedAt,
      },
    ];
    await item.save();

    if (status === 'approved') {
      await User.findOneAndUpdate(
        { $or: [{ firebaseUid: item.userId }, { uid: item.userId }] },
        {
          role: 'rider',
          riderApprovalStatus: 'approved',
          riderVehicleType: item.vehicle || '',
          riderCity: item.city || '',
          $set: {
            'roles.rider': true,
          },
        }
      );
    }

    if (status === 'rejected') {
      await User.findOneAndUpdate(
        { $or: [{ firebaseUid: item.userId }, { uid: item.userId }] },
        {
          riderApprovalStatus: 'rejected',
        }
      );
    }

    return res.status(200).json({ success: true, data: serializeRiderKyc(item) });
  } catch (error) {
    return next(error);
  }
}

async function listTrialHomeSessions(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const status = String(req.query.status || '').trim().toLowerCase();
    const filter = status ? { status } : {};
    const sessions = await TrialHomeSession.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(500);
    return res.status(200).json({
      success: true,
      data: sessions.map(serializeTrialHomeSession),
    });
  } catch (error) {
    return next(error);
  }
}

async function getTrialHomeSession(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const session = await TrialHomeSession.findById(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: 'Trial-home session not found.' });
    }
    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateTrialHomeSession(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const session = await TrialHomeSession.findById(req.params.id);
    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: 'Trial-home session not found.' });
    }

    const nextStatus = String(req.body?.status || '').trim();
    const note = String(req.body?.note || '').trim();
    const nextPaymentStatus = String(req.body?.paymentStatus || '').trim();

    const allowedStatuses = new Set([
      'draft',
      'booked',
      'confirmed',
      'out_for_trial_delivery',
      'trial_in_progress',
      'completed',
      'converted_to_order',
      'converted_to_tailoring',
      'cancelled',
    ]);
    const allowedPaymentStatuses = new Set([
      'pending',
      'held',
      'refunded',
      'waived',
    ]);

    if (nextStatus && !allowedStatuses.has(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trial-home status.',
      });
    }
    if (nextPaymentStatus && !allowedPaymentStatuses.has(nextPaymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trial-home payment status.',
      });
    }

    if (nextStatus) {
      session.status = nextStatus;
    }
    if (nextPaymentStatus) {
      session.paymentStatus = nextPaymentStatus;
    }

    session.events = [
      ...(session.events || []),
      {
        type: nextStatus ? 'admin_status_update' : 'admin_note',
        actorId: req.user?.uid || '',
        note:
          note ||
          (nextStatus
            ? `Admin updated trial-home status to ${nextStatus}.`
            : 'Admin update'),
        createdAt: new Date(),
      },
    ];

    await session.save();
    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getDashboardSummary,
  listUsers,
  listStores,
  listProducts,
  listOrders,
  getPlatformSettings,
  savePlatformSettings,
  listNotifications,
  createNotification,
  listPayouts,
  processPayout,
  listDisputes,
  updateDispute,
  listActivityLogs,
  createActivityLog,
  listVendorKycRequests,
  listRiderKycRequests,
  approveVendor,
  fixVendorStore,
  reviewVendorKycRequest,
  reviewRiderKycRequest,
  listTrialHomeSessions,
  getTrialHomeSession,
  updateTrialHomeSession,
};
