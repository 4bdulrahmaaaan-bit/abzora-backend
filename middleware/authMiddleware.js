const initializeFirebase = require('../config/firebase');
const User = require('../models/User');

const VALID_ROLES = new Set(['user', 'customer', 'vendor', 'rider', 'admin', 'super_admin']);

function normalizeRole(role, fallback = 'customer') {
  const normalized = role?.toString().trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : fallback;
}

function serializeUser(user) {
  const roles =
    user?.roles instanceof Map
      ? Object.fromEntries(user.roles.entries())
      : Object.fromEntries(Object.entries(user?.roles || {}).map(([key, value]) => [key, Boolean(value)]));

  return {
    firebaseUid: user?.firebaseUid || user?.uid || '',
    _id: user?._id,
    uid: user?.firebaseUid || user?.uid || '',
    phone: user?.phone || null,
    email: user?.email || null,
    name: user?.name || 'ABZORA Member',
    profileImageUrl: user?.profileImageUrl || '',
    address: user?.address || '',
    area: user?.area || '',
    city: user?.city || '',
    latitude: user?.latitude ?? null,
    longitude: user?.longitude ?? null,
    deliveryRadiusKm: user?.deliveryRadiusKm ?? 10,
    locationUpdatedAt: user?.locationUpdatedAt || '',
    role: normalizeRole(user?.role, 'customer'),
    roles,
    isActive: user?.isActive ?? true,
    storeId: user?.storeId || '',
    walletBalance: user?.walletBalance ?? 0,
    riderApprovalStatus: user?.riderApprovalStatus || 'pending',
    riderVehicleType: user?.riderVehicleType || '',
    riderLicenseNumber: user?.riderLicenseNumber || '',
    riderCity: user?.riderCity || '',
    createdAt: user?.createdAt || null,
  };
}

async function upsertFirebaseUser(decoded) {
  let user = await User.findOne({
    $or: [{ firebaseUid: decoded.uid }, { uid: decoded.uid }],
  });

  if (!user) {
    user = await User.create({
      firebaseUid: decoded.uid,
      uid: decoded.uid,
      email: decoded.email || '',
      phone: decoded.phone_number || '',
      name: decoded.name || 'ABZORA Member',
      role: normalizeRole(decoded.role, 'customer'),
      roles: decoded.roles && Object.keys(decoded.roles || {}).length
        ? decoded.roles
        : { customer: true },
    });
    return user;
  }

  user.firebaseUid = decoded.uid;
  user.uid = decoded.uid;
  user.email = decoded.email || user.email;
  user.phone = decoded.phone_number || user.phone;
  user.name = decoded.name || user.name;
  user.role = normalizeRole(user.role, 'customer');
  if (!user.roles || Object.keys(user.roles instanceof Map ? Object.fromEntries(user.roles.entries()) : user.roles).length == 0) {
    user.roles = { customer: true };
  }
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    message: 'Unauthorized',
  });
}

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return unauthorized(res);
    }

    const token = authHeader.split(' ')[1]?.trim();
    if (!token) {
      return unauthorized(res);
    }

    const admin = initializeFirebase();
    if (!admin) {
      console.warn('Firebase Admin is unavailable. Protected routes cannot authenticate requests.');
      return unauthorized(res);
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const user = await upsertFirebaseUser(decoded);

    if (process.env.NODE_ENV === 'development') {
      console.log('Authenticated UID:', decoded.uid);
    }

    req.auth = decoded;
    req.dbUser = user;
    req.user = {
      uid: decoded.uid,
      firebaseUid: decoded.uid,
      email: decoded.email || null,
      phone: decoded.phone_number || null,
      ...serializeUser(user),
    };

    return next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return unauthorized(res);
  }
}

module.exports = authMiddleware;
module.exports.serializeUser = serializeUser;
module.exports.normalizeRole = normalizeRole;
