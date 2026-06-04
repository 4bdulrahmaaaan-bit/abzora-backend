const initializeFirebase = require('../config/firebase');
const User = require('../models/User');
const { getSessionById, verifyAccessToken } = require('../services/authSessionService');
const { clientIp, logSecurityEvent, logSecurityWarning } = require('../services/auditLogger');

const VALID_ROLES = new Set([
  'user',
  'customer',
  'vendor',
  'rider',
  'admin',
  'super_admin',
  'designer',
  'qa',
]);
const PRIVILEGED_ROLES = new Set(['admin', 'super_admin']);

function allowedAdminEmails() {
  return (process.env.ALLOWED_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function allowAdminEmailPromotion() {
  // Security hardening: production must opt in explicitly to email-based admin promotion.
  // This prevents accidental privilege escalation from misconfigured allowlists.
  if (String(process.env.ENABLE_ADMIN_EMAIL_PROMOTION || '').trim().toLowerCase() !== 'true') {
    return false;
  }
  return true;
}

function isAllowedAdminEmail(email) {
  if (!allowAdminEmailPromotion()) {
    return false;
  }
  const normalized = email?.toString().trim().toLowerCase() || '';
  return normalized ? allowedAdminEmails().includes(normalized) : false;
}

function normalizeRole(role, fallback = 'customer') {
  const normalized = role?.toString().trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : fallback;
}

function normalizePhone(value) {
  const raw = value?.toString().trim() || '';
  if (!raw) return '';
  const digitsOnly = raw.replace(/[^0-9+]/g, '');
  if (digitsOnly.startsWith('+')) {
    return digitsOnly;
  }
  return digitsOnly;
}

function buildPhoneLookupCandidates(value) {
  const normalized = normalizePhone(value);
  if (!normalized) {
    return [];
  }
  const digitsOnly = normalized.replace(/[^0-9]/g, '');
  return [
    { phone: normalized },
    ...(digitsOnly && digitsOnly !== normalized ? [{ phone: digitsOnly }] : []),
  ];
}

function roleMapFromUser(user) {
  if (!user?.roles) return {};
  const raw = user.roles instanceof Map
    ? Object.fromEntries(user.roles.entries())
    : user.roles;
  const normalized = {};
  for (const [key, value] of Object.entries(raw || {})) {
    normalized[key.toString().trim().toLowerCase()] = Boolean(value);
  }
  return normalized;
}

function hasOperationsCapability(user) {
  const role = normalizeRole(user?.role, '');
  if (role === 'vendor' || role === 'rider') {
    return true;
  }
  const roles = roleMapFromUser(user);
  if (roles.vendor === true || roles.rider === true) {
    return true;
  }
  const storeId = user?.storeId?.toString().trim() || '';
  if (storeId) {
    return true;
  }
  const approval = (user?.riderApprovalStatus || '').toString().trim().toLowerCase();
  return approval === 'approved';
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

async function upsertFirebaseUser(decoded, options = {}) {
  const allowCreate = options.allowCreate === true;
  const decodedEmail = decoded.email || '';
  const decodedPhone = normalizePhone(decoded.phone_number || '');
  // Security hardening: only promote by allowlisted email when token email is verified.
  const shouldPromoteAdmin = decoded.email_verified === true && isAllowedAdminEmail(decodedEmail);

  let user = await User.findOne({
    $or: [
      { firebaseUid: decoded.uid },
      { uid: decoded.uid },
      ...(decodedEmail ? [{ email: decodedEmail }] : []),
      ...buildPhoneLookupCandidates(decodedPhone),
    ],
  });

  if (!user) {
    // Allowlisted admin emails are an explicit production bootstrap path.
    // General user auto-provisioning remains disabled in production, but an
    // email that passes ENABLE_ADMIN_EMAIL_PROMOTION + ALLOWED_ADMIN_EMAILS
    // must be able to create its immutable Mongo user record on first login.
    if (!allowCreate && !shouldPromoteAdmin) {
      return null;
    }
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

function unauthorizedWithMessage(res, message) {
  return res.status(401).json({
    success: false,
    message,
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

    let decoded = null;
    let authSource = 'firebase';
    let session = null;

    try {
      const accessPayload = verifyAccessToken(token);
      session = await getSessionById(accessPayload.sid);
      if (!session || session.revokedAt || (session.refreshTokenExpiresAt && session.refreshTokenExpiresAt <= new Date())) {
        return unauthorizedWithMessage(res, 'Session expired. Please sign in again.');
      }
      decoded = {
        uid: accessPayload.uid,
        email: accessPayload.email || null,
        phone_number: accessPayload.phone || null,
        email_verified: true,
        auth_time: Math.floor((session.lastUsedAt || session.createdAt || new Date()).getTime() / 1000),
        firebase: { sign_in_provider: 'custom' },
        role: accessPayload.role || 'customer',
      };
      authSource = 'backend-jwt';
    } catch (_) {
      const admin = initializeFirebase();
      if (!admin) {
        console.warn('Firebase Admin is unavailable. Protected routes cannot authenticate requests.');
        return unauthorized(res);
      }
      decoded = await admin.auth().verifyIdToken(token, true);
    }

    if (authSource === 'firebase') {
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

    // Security hardening: prevent silent account auto-provision in production unless explicitly re-enabled.
    const allowAutoProvision =
      process.env.AUTH_ALLOW_AUTO_PROVISION === 'true' &&
      String(process.env.DISABLE_AUTH_AUTO_PROVISION_IN_PRODUCTION || '').trim().toLowerCase() !== 'true' &&
      process.env.NODE_ENV !== 'production';
    const user = await upsertFirebaseUser(decoded, { allowCreate: allowAutoProvision });
    if (!user) {
      return res.status(403).json({
        success: false,
        message: 'Account is not provisioned for this environment.',
      });
    }
    if (user?.isDeleted === true) {
      return res.status(403).json({
        success: false,
        message: 'This account has been deleted.',
      });
    }
    if (user?.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'This account has been disabled.',
      });
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`Authenticated UID (${authSource}):`, decoded.uid);
    }

    req.auth = decoded;
    req.authSource = authSource;
    req.session = session;
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
    logSecurityEvent('auth_session_validated', {
      requestId: req.requestId,
      uid: decoded.uid,
      source: authSource,
      sessionId: session?.sessionId || null,
    });

    return next();
  } catch (error) {
    logSecurityWarning('auth_failed', {
      requestId: req.requestId,
      path: req.originalUrl,
      ip: clientIp(req),
      message: error.message,
    });
    if (error?.code === 'auth/id-token-expired') {
      return unauthorizedWithMessage(
        res,
        'Session expired. Please sign in again.',
      );
    }
    if (error?.code === 'auth/id-token-revoked') {
      return unauthorizedWithMessage(
        res,
        'Session revoked. Please sign in again.',
      );
    }
    return unauthorized(res);
  }
}

module.exports = authMiddleware;
module.exports.serializeUser = serializeUser;
module.exports.normalizeRole = normalizeRole;
module.exports.upsertFirebaseUser = upsertFirebaseUser;
