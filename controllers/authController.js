const { normalizeRole, serializeUser } = require('../middleware/authMiddleware');
const Store = require('../models/Store');
const User = require('../models/User');
const UserAddress = require('../models/UserAddress');
const UserMemory = require('../models/UserMemory');

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
    pastIssues: Array.isArray(memory?.pastIssues) ? memory.pastIssues : [],
    lastOrderId: memory?.lastOrderId || '',
    lastConversationSummary: memory?.lastConversationSummary || '',
    updatedAt: memory?.updatedAtIso || memory?.updatedAt?.toISOString?.() || '',
  };
}

async function ensureLinkedStoreId(user) {
  if (!user || user.role !== 'vendor' || (user.storeId || '').trim().length > 0) {
    return user;
  }

  const linkedStore = await Store.findOne({
    $or: [
      ...(user._id ? [{ vendorId: user._id }] : []),
      ...(user.firebaseUid ? [{ ownerId: user.firebaseUid }] : []),
      ...(user.uid ? [{ ownerId: user.uid }] : []),
    ],
  }).sort({ createdAt: -1 });

  if (!linkedStore) {
    return user;
  }

  user.storeId = linkedStore._id.toString();
  await user.save();
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
    const memory = await UserMemory.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        name: toSafeTrimmedString(req.body?.name),
        preferredStyle: toSafeTrimmedString(req.body?.preferredStyle),
        size: toSafeTrimmedString(req.body?.size),
        pastIssues: Array.isArray(req.body?.pastIssues)
          ? req.body.pastIssues.map((item) => item?.toString?.().trim?.() || '').filter(Boolean)
          : [],
        lastOrderId: toSafeTrimmedString(req.body?.lastOrderId),
        lastConversationSummary: toSafeTrimmedString(req.body?.lastConversationSummary),
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
