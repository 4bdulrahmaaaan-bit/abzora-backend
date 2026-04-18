const initializeFirebase = require('../config/firebase');
const User = require('../models/User');
const { clientIp, logSecurityWarning } = require('../services/auditLogger');

const VALID_ROLES = new Set(['user', 'customer', 'vendor', 'rider', 'admin', 'super_admin']);
const PRIVILEGED_ROLES = new Set(['admin', 'super_admin']);

function allowedAdminEmails() {
  return (process.env.ALLOWED_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedAdminEmail(email) {
  const normalized = email?.toString().trim().toLowerCase() || '';
  return normalized ? allowedAdminEmails().includes(normalized) : false;
}

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
    referralCode: user?.referralCode || '',
    referredBy: user?.referredBy || '',
    riderApprovalStatus: user?.riderApprovalStatus || 'pending',
    riderVehicleType: user?.riderVehicleType || '',
    riderLicenseNumber: user?.riderLicenseNumber || '',
    riderCity: user?.riderCity || '',
    createdAt: user?.createdAt || null,
  };
}

async function upsertFirebaseUser(decoded) {
  const decodedEmail = decoded.email || '';
  const decodedPhone = decoded.phone_number || '';
  const shouldPromoteAdmin = isAllowedAdminEmail(decodedEmail);

  let user = await User.findOne({
    $or: [
      { firebaseUid: decoded.uid },
      { uid: decoded.uid },
      ...(decodedEmail ? [{ email: decodedEmail }] : []),
      ...(decodedPhone ? [{ phone: decodedPhone }] : []),
    ],
  });

  if (!user) {
    user = await User.create({
      firebaseUid: decoded.uid,
      uid: decoded.uid,
      email: decodedEmail,
      phone: decodedPhone,
      name: decoded.name || 'ABZORA Member',
      role: shouldPromoteAdmin ? 'admin' : normalizeRole(decoded.role, 'customer'),
      roles: decoded.roles && Object.keys(decoded.roles || {}).length
        ? decoded.roles
        : shouldPromoteAdmin
          ? { admin: true }
          : { customer: true },
    });
    return user;
  }

  user.firebaseUid = decoded.uid;
  user.uid = decoded.uid;
  user.email = decodedEmail || user.email;
  user.phone = decodedPhone || user.phone;
  user.name = decoded.name || user.name;
  user.role = shouldPromoteAdmin ? 'admin' : normalizeRole(user.role, 'customer');
  if (!user.roles || Object.keys(user.roles instanceof Map ? Object.fromEntries(user.roles.entries()) : user.roles).length == 0) {
    user.roles = shouldPromoteAdmin ? { admin: true } : { customer: true };
  } else if (shouldPromoteAdmin) {
    const nextRoles = user.roles instanceof Map
      ? Object.fromEntries(user.roles.entries())
      : { ...user.roles };
    nextRoles.admin = true;
    user.roles = nextRoles;
  }
  if (shouldPromoteAdmin && !PRIVILEGED_ROLES.has(user.role)) {
    user.role = 'admin';
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

    const decoded = await admin.auth().verifyIdToken(token, true);
    const maxSessionAgeMinutes = Number(process.env.AUTH_MAX_SESSION_AGE_MINUTES || 480);
    const authTimeMs = Number(decoded.auth_time || 0) * 1000;
    if (
      Number.isFinite(maxSessionAgeMinutes) &&
      maxSessionAgeMinutes > 0 &&
      authTimeMs > 0 &&
      (Date.now() - authTimeMs) > maxSessionAgeMinutes * 60 * 1000
    ) {
      logSecurityWarning('stale_session_rejected', {
        requestId: req.requestId,
        uid: decoded.uid,
        ip: clientIp(req),
      });
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please sign in again.',
      });
    }

    const requireVerifiedEmail = process.env.REQUIRE_EMAIL_VERIFICATION !== 'false';
    if (
      requireVerifiedEmail &&
      decoded.email &&
      decoded.firebase?.sign_in_provider === 'password' &&
      decoded.email_verified !== true
    ) {
      return res.status(403).json({
        success: false,
        message: 'Verify your email address before continuing.',
      });
    }

    const user = await upsertFirebaseUser(decoded);
    if (user?.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'This account has been disabled.',
      });
    }

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
      emailVerified: decoded.email_verified === true,
      authTime: decoded.auth_time || null,
      ...serializeUser(user),
    };

    return next();
  } catch (error) {
    logSecurityWarning('auth_failed', {
      requestId: req.requestId,
      path: req.originalUrl,
      ip: clientIp(req),
      message: error.message,
    });
    return unauthorized(res);
  }
}

module.exports = authMiddleware;
module.exports.serializeUser = serializeUser;
module.exports.normalizeRole = normalizeRole;
