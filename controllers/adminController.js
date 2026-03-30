const User = require('../models/User');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Order = require('../models/Order');
const SupportChat = require('../models/SupportChat');
const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');
const { isAllowedAdminEmail } = require('./authController');

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
    name: item.name || '',
    description: item.description || '',
    rating: Number(item.rating || 0),
    logoUrl: item.logoUrl || '',
    ownerId: item.ownerId || '',
    isActive: item.isActive !== false,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
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
    const commissionRevenue = totalRevenue * 0.12;
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

    return res.status(200).json({
      success: true,
      data: {
        usersCount,
        storesCount,
        productsCount,
        totalOrders,
        totalRevenue,
        platformCommissionRevenue: commissionRevenue,
        openSupportChats,
        pendingVendorKyc,
        pendingRiderKyc,
        topStores,
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

    if (status === 'approved') {
      await User.findOneAndUpdate(
        { $or: [{ firebaseUid: item.userId }, { uid: item.userId }] },
        {
          role: 'vendor',
          storeId: '',
          $set: {
            'roles.vendor': true,
          },
        }
      );
    }

    return res.status(200).json({ success: true, data: serializeVendorKyc(item) });
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

module.exports = {
  getDashboardSummary,
  listUsers,
  listStores,
  listProducts,
  listOrders,
  listVendorKycRequests,
  listRiderKycRequests,
  reviewVendorKycRequest,
  reviewRiderKycRequest,
};
