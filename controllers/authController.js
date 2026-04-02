const mongoose = require('mongoose');
const { normalizeRole, serializeUser } = require('../middleware/authMiddleware');
const Store = require('../models/Store');
const User = require('../models/User');
const UserAddress = require('../models/UserAddress');
const UserMemory = require('../models/UserMemory');
const UserStyleProfile = require('../models/UserStyleProfile');
const VendorKycRequest = require('../models/VendorKycRequest');

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin']);
const SELF_ASSIGNABLE_ROLES = new Set(['user', 'customer', 'vendor', 'rider']);
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'suspended']);

function allowedAdminEmails() {
  return (process.env.ALLOWED_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedAdminEmail(email) {
  const normalized = toSafeTrimmedString(email).toLowerCase();
  if (!normalized) {
    return false;
  }
  return allowedAdminEmails().includes(normalized);
}

function toSafeTrimmedString(value) {
  return value == null ? '' : value.toString().trim();
}

function sanitizeRoles(input, fallbackRole) {
  const candidate = input && typeof input === 'object' ? input : {};
  const roles = {};
  for (const [key, value] of Object.entries(candidate)) {
    const normalizedKey = normalizeRole(key, '');
    if (!normalizedKey || PRIVILEGED_ROLES.has(normalizedKey)) {
      continue;
    }
    roles[normalizedKey] = Boolean(value);
  }
  if (fallbackRole && SELF_ASSIGNABLE_ROLES.has(fallbackRole)) {
    roles[fallbackRole] = true;
  }
  return roles;
}

function serializeUserResponse(user) {
  return {
    id: user?._id?.toString?.() || null,
    ...serializeUser(user),
  };
}

function serializeAddress(address) {
  return {
    id: address?.addressId || '',
    userId: address?.userId || '',
    name: address?.name || '',
    phone: address?.phone || '',
    addressLine: address?.addressLine || '',
    city: address?.city || '',
    state: address?.state || '',
    pincode: address?.pincode || '',
    houseDetails: address?.houseDetails || '',
    landmark: address?.landmark || '',
    locality: address?.locality || '',
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
    type: address?.type || 'home',
    createdAt: address?.createdAtIso || address?.createdAt?.toISOString?.() || '',
  };
}

function serializeUserMemory(memory, userId) {
  return {
    userId,
    name: memory?.name || '',
    preferredStyle: memory?.preferredStyle || '',
    size: memory?.size || '',
    heightCm: memory?.heightCm ?? null,
    weightKg: memory?.weightKg ?? null,
    bodyType: memory?.bodyType || '',
    recommendedSize: memory?.recommendedSize || memory?.size || '',
    pantSize: memory?.pantSize || '',
    confidence: memory?.confidence ?? null,
    pastIssues: Array.isArray(memory?.pastIssues) ? memory.pastIssues : [],
    lastOrderId: memory?.lastOrderId || '',
    lastConversationSummary: memory?.lastConversationSummary || '',
    cartItems: Array.isArray(memory?.cartItems) ? memory.cartItems : [],
    cartUpdatedAt: memory?.cartUpdatedAtIso || '',
    updatedAt: memory?.updatedAtIso || memory?.updatedAt?.toISOString?.() || '',
  };
}

function normalizeCartItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ...item,
      productId: toSafeTrimmedString(item.productId),
      size: toSafeTrimmedString(item.size),
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      product:
        item.product && typeof item.product === 'object'
          ? { ...item.product }
          : {},
    }))
    .filter((item) => item.productId);
}

async function findApprovedVendorKyc(user) {
  if (!user) {
    return null;
  }

  return VendorKycRequest.findOne({
    status: 'approved',
    $or: [
      ...(user.firebaseUid ? [{ userId: user.firebaseUid }] : []),
      ...(user.uid ? [{ userId: user.uid }] : []),
      ...(user.phone ? [{ phone: user.phone }] : []),
    ],
  }).sort({ updatedAt: -1, _id: -1 });
}

async function ensureLinkedStoreId(user) {
  if (!user) {
    return user;
  }

  const approvedVendorKyc = await findApprovedVendorKyc(user);
  const shouldPromoteVendor =
    user.role === 'vendor' ||
    Boolean(approvedVendorKyc);

  if (!shouldPromoteVendor) {
    return user;
  }

  const currentRoles =
    user.roles instanceof Map
      ? Object.fromEntries(user.roles.entries())
      : { ...(user.roles || {}) };

  let needsSave = false;
  if (user.role !== 'vendor') {
    user.role = 'vendor';
    needsSave = true;
  }
  if (!user.isActive) {
    user.isActive = true;
    needsSave = true;
  }
  if (!currentRoles.vendor) {
    currentRoles.vendor = true;
    user.roles = currentRoles;
    needsSave = true;
  }

  let linkedStore = await Store.findOne({
    $or: [
      ...(user._id ? [{ vendorId: user._id }] : []),
      ...(user.firebaseUid ? [{ ownerId: user.firebaseUid }] : []),
      ...(user.uid ? [{ ownerId: user.uid }] : []),
      ...((user.storeId || '').trim().length > 0 && mongoose.Types.ObjectId.isValid(user.storeId)
        ? [{ _id: user.storeId }]
        : []),
    ],
  }).sort({ createdAt: -1 });

  if (!linkedStore && approvedVendorKyc) {
    linkedStore = await Store.create({
      vendorId: user._id,
      ownerId: user.firebaseUid || user.uid || user._id.toString(),
      name:
        toSafeTrimmedString(approvedVendorKyc.storeName) ||
        toSafeTrimmedString(approvedVendorKyc.ownerName) ||
        toSafeTrimmedString(user.name) ||
        'My Store',
      description: toSafeTrimmedString(approvedVendorKyc.address),
      isActive: true,
    });
    needsSave = true;
  }

  if (linkedStore) {
    if (!linkedStore.vendorId && user._id) {
      linkedStore.vendorId = user._id;
      await linkedStore.save();
    }
    if ((user.storeId || '').trim() !== linkedStore._id.toString()) {
      user.storeId = linkedStore._id.toString();
      needsSave = true;
    }
  }

  if (needsSave) {
    await user.save();
  }

  return user;
}

async function me(req, res, next) {
  try {
    let user = req.dbUser;
    if (user && isAllowedAdminEmail(req.user?.email || user.email)) {
      if (!PRIVILEGED_ROLES.has(user.role)) {
        user.role = 'admin';
      }
      const nextRoles =
        user.roles instanceof Map
          ? Object.fromEntries(user.roles.entries())
          : { ...(user.roles || {}) };
      nextRoles.admin = true;
      user.roles = nextRoles;
      user.email = toSafeTrimmedString(req.user?.email) || user.email;
      await user.save();
      req.user = {
        ...req.user,
        ...serializeUser(user),
        _id: user._id,
      };
    }

    user = await ensureLinkedStoreId(user);
    if (user) {
      req.user = {
        ...req.user,
        ...serializeUser(user),
        _id: user._id,
      };
    }

  return res.status(200).json({
    success: true,
    data: serializeUserResponse(user || req.user),
  });
  } catch (error) {
    return next(error);
  }
}

function debugAuth(req, res) {
  return res.status(200).json({
    success: true,
    data: {
      mode: 'firebase',
      user: {
        id: req.user._id || null,
        uid: req.user.uid,
        role: req.user.role || null,
        phone: req.user.phone || null,
        name: req.user.name || null,
        storeId: req.user.storeId || null,
        riderApprovalStatus: req.user.riderApprovalStatus || null,
      },
    },
  });
}

function normalizePhone(value) {
  return value == null ? '' : value.toString().trim();
}

async function upsertTestUser(req, res, next) {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'phone is required.',
      });
    }

    let user = await User.findOne({ phone });
    if (!user) {
      const syntheticUid = `phone:${phone}`;
      user = await User.create({
        firebaseUid: syntheticUid,
        uid: syntheticUid,
        phone,
        role: 'customer',
        roles: { customer: true },
        name: 'ABZORA Member',
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeUserResponse(user),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function syncProfile(req, res, next) {
  try {
    if (!req.dbUser) {
      return res.status(400).json({
        success: false,
        message: 'Profile sync is unavailable in test mode.',
      });
    }

    const requestedRole = normalizeRole(req.body?.role, req.dbUser.role || 'user');
    if (PRIVILEGED_ROLES.has(requestedRole) && !PRIVILEGED_ROLES.has(req.dbUser.role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role update.',
      });
    }

    req.dbUser.name = toSafeTrimmedString(req.body?.name) || req.dbUser.name || 'ABZORA Member';
    req.dbUser.phone = toSafeTrimmedString(req.body?.phone) || req.dbUser.phone;
    req.dbUser.email = toSafeTrimmedString(req.body?.email) || req.dbUser.email;
    req.dbUser.profileImageUrl = toSafeTrimmedString(req.body?.profileImageUrl);
    req.dbUser.address = toSafeTrimmedString(req.body?.address);
    req.dbUser.area = toSafeTrimmedString(req.body?.area);
    req.dbUser.city = toSafeTrimmedString(req.body?.city);
    req.dbUser.latitude = req.body?.latitude == null ? null : Number(req.body.latitude);
    req.dbUser.longitude = req.body?.longitude == null ? null : Number(req.body.longitude);
    req.dbUser.deliveryRadiusKm = req.body?.deliveryRadiusKm == null
      ? req.dbUser.deliveryRadiusKm || 10
      : Number(req.body.deliveryRadiusKm);
    req.dbUser.locationUpdatedAt = toSafeTrimmedString(req.body?.locationUpdatedAt);
    req.dbUser.isActive = req.body?.isActive ?? req.dbUser.isActive;
    req.dbUser.role = requestedRole;
    req.dbUser.roles = sanitizeRoles(req.body?.roles, requestedRole);
    const requestedStoreId = toSafeTrimmedString(req.body?.storeId);
    req.dbUser.storeId = requestedStoreId || req.dbUser.storeId || '';
    req.dbUser.walletBalance = req.body?.walletBalance == null
      ? req.dbUser.walletBalance || 0
      : Number(req.body.walletBalance);
    req.dbUser.riderApprovalStatus = APPROVAL_STATUSES.has(req.body?.riderApprovalStatus)
      ? req.body.riderApprovalStatus
      : req.dbUser.riderApprovalStatus || 'pending';
    req.dbUser.riderVehicleType = toSafeTrimmedString(req.body?.riderVehicleType);
    req.dbUser.riderLicenseNumber = toSafeTrimmedString(req.body?.riderLicenseNumber);
    req.dbUser.riderCity = toSafeTrimmedString(req.body?.riderCity);
    req.dbUser.lastLoginAt = new Date();

    await req.dbUser.save();
    await ensureLinkedStoreId(req.dbUser);

    req.user = {
      ...req.user,
      ...serializeUser(req.dbUser),
      _id: req.dbUser._id,
    };

    return res.status(200).json({
      success: true,
      data: serializeUserResponse(req.dbUser),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listAddresses(req, res, next) {
  try {
    const addresses = await UserAddress.find({ userId: req.user.uid }).sort({ createdAt: -1, _id: -1 });
    return res.status(200).json({
      success: true,
      data: addresses.map((item) => serializeAddress(item)),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveAddress(req, res, next) {
  try {
    const addressId = toSafeTrimmedString(req.body?.id) || `addr-${Date.now()}`;
    const createdAtIso = toSafeTrimmedString(req.body?.createdAt) || new Date().toISOString();
    const address = await UserAddress.findOneAndUpdate(
      {
        addressId,
        userId: req.user.uid,
      },
      {
        addressId,
        userId: req.user.uid,
        name: toSafeTrimmedString(req.body?.name),
        phone: toSafeTrimmedString(req.body?.phone),
        addressLine: toSafeTrimmedString(req.body?.addressLine),
        city: toSafeTrimmedString(req.body?.city),
        state: toSafeTrimmedString(req.body?.state),
        pincode: toSafeTrimmedString(req.body?.pincode),
        houseDetails: toSafeTrimmedString(req.body?.houseDetails),
        landmark: toSafeTrimmedString(req.body?.landmark),
        locality: toSafeTrimmedString(req.body?.locality),
        latitude: req.body?.latitude == null ? null : Number(req.body.latitude),
        longitude: req.body?.longitude == null ? null : Number(req.body.longitude),
        type: toSafeTrimmedString(req.body?.type) || 'home',
        createdAtIso,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      data: serializeAddress(address),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteAddress(req, res, next) {
  try {
    const addressId = toSafeTrimmedString(req.params.id);
    if (!addressId) {
      return res.status(400).json({ success: false, message: 'Address id is required.' });
    }

    await UserAddress.deleteOne({ addressId, userId: req.user.uid });
    return res.status(200).json({
      success: true,
      data: { deleted: true, id: addressId },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMemory(req, res, next) {
  try {
    const memory = await UserMemory.findOne({ userId: req.user.uid });
    return res.status(200).json({
      success: true,
      data: memory ? serializeUserMemory(memory, req.user.uid) : null,
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMemory(req, res, next) {
  try {
    const existingMemory = await UserMemory.findOne({ userId: req.user.uid });
    const has = (key) => Object.prototype.hasOwnProperty.call(req.body || {}, key);
    const nowIso = new Date().toISOString();
    const memory = await UserMemory.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        name: has('name') ? toSafeTrimmedString(req.body?.name) : existingMemory?.name || '',
        preferredStyle: has('preferredStyle')
          ? toSafeTrimmedString(req.body?.preferredStyle)
          : existingMemory?.preferredStyle || '',
        size: has('size') ? toSafeTrimmedString(req.body?.size) : existingMemory?.size || '',
        heightCm: has('heightCm')
          ? (req.body?.heightCm == null ? null : Number(req.body.heightCm))
          : existingMemory?.heightCm ?? null,
        weightKg: has('weightKg')
          ? (req.body?.weightKg == null ? null : Number(req.body.weightKg))
          : existingMemory?.weightKg ?? null,
        bodyType: has('bodyType')
          ? toSafeTrimmedString(req.body?.bodyType)
          : existingMemory?.bodyType || '',
        recommendedSize: has('recommendedSize') || has('size')
          ? (toSafeTrimmedString(req.body?.recommendedSize) || toSafeTrimmedString(req.body?.size))
          : existingMemory?.recommendedSize || existingMemory?.size || '',
        pantSize: has('pantSize') ? toSafeTrimmedString(req.body?.pantSize) : existingMemory?.pantSize || '',
        confidence: has('confidence')
          ? (req.body?.confidence == null ? null : Number(req.body.confidence))
          : existingMemory?.confidence ?? null,
        pastIssues: has('pastIssues')
          ? (Array.isArray(req.body?.pastIssues)
              ? req.body.pastIssues.map((item) => item?.toString?.().trim?.() || '').filter(Boolean)
              : [])
          : (Array.isArray(existingMemory?.pastIssues) ? existingMemory.pastIssues : []),
        lastOrderId: has('lastOrderId')
          ? toSafeTrimmedString(req.body?.lastOrderId)
          : existingMemory?.lastOrderId || '',
        lastConversationSummary: has('lastConversationSummary')
          ? toSafeTrimmedString(req.body?.lastConversationSummary)
          : existingMemory?.lastConversationSummary || '',
        cartItems: has('cartItems')
          ? normalizeCartItems(req.body?.cartItems)
          : (Array.isArray(existingMemory?.cartItems) ? existingMemory.cartItems : []),
        cartUpdatedAtIso: has('cartItems') || has('cartUpdatedAt')
          ? (toSafeTrimmedString(req.body?.cartUpdatedAt) || nowIso)
          : existingMemory?.cartUpdatedAtIso || '',
        updatedAtIso: toSafeTrimmedString(req.body?.updatedAt) || nowIso,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await UserStyleProfile.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        bodyType: toSafeTrimmedString(req.body?.bodyType),
        size:
          toSafeTrimmedString(req.body?.recommendedSize) ||
          toSafeTrimmedString(req.body?.size),
        updatedAtIso: toSafeTrimmedString(req.body?.updatedAt) || new Date().toISOString(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      data: serializeUserMemory(memory, req.user.uid),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  me,
  debugAuth,
  upsertTestUser,
  syncProfile,
  listAddresses,
  saveAddress,
  deleteAddress,
  getMemory,
  saveMemory,
  isAllowedAdminEmail,
};
