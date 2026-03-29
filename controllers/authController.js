const { normalizeRole, serializeUser } = require('../middleware/authMiddleware');

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin']);
const SELF_ASSIGNABLE_ROLES = new Set(['user', 'customer', 'vendor', 'rider']);
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'suspended']);

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

function me(req, res) {
  return res.status(200).json({
    success: true,
    data: serializeUserResponse(req.user),
  });
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
    req.dbUser.storeId = toSafeTrimmedString(req.body?.storeId) || '';
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

module.exports = {
  me,
  debugAuth,
  syncProfile,
};
