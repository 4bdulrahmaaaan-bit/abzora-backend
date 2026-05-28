const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { logSecurityEvent, logSecurityWarning } = require('./auditLogger');
const AuthSession = require('../models/AuthSession');
const User = require('../models/User');

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function sessionJwtSecret() {
  return (
    process.env.AUTH_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SESSION_JWT_SECRET ||
    ''
  );
}

function sessionJwtIssuer() {
  return process.env.AUTH_JWT_ISSUER || 'abzora-backend';
}

function sessionJwtAudience() {
  return process.env.AUTH_JWT_AUDIENCE || 'abzora-app';
}

function toSafeString(value) {
  return value == null ? '' : String(value).trim();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateDeviceId() {
  return crypto.randomBytes(16).toString('hex');
}

function scheduleCleanup() {
  setImmediate(() => {
    cleanupExpiredSessions().catch((error) => {
      logSecurityWarning('auth_session_cleanup_failed', {
        message: error.message,
      });
    });
  });
}

function signAccessToken({
  sessionId,
  user,
  expiresInSeconds = ACCESS_TOKEN_TTL_SECONDS,
}) {
  const secret = sessionJwtSecret();
  if (!secret) {
    throw new Error('AUTH_JWT_SECRET is not configured.');
  }
  return jwt.sign(
    {
      typ: 'access',
      sid: sessionId,
      uid: toSafeString(user?.uid || user?.firebaseUid),
      role: toSafeString(user?.role || 'customer'),
      email: toSafeString(user?.email),
      phone: toSafeString(user?.phone),
      isActive: user?.isActive !== false,
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: expiresInSeconds,
      issuer: sessionJwtIssuer(),
      audience: sessionJwtAudience(),
      subject: toSafeString(user?.uid || user?.firebaseUid),
    },
  );
}

function verifyAccessToken(token) {
  const secret = sessionJwtSecret();
  if (!secret) {
    const error = new Error('AUTH_JWT_SECRET is not configured.');
    error.code = 'auth/jwt-not-configured';
    throw error;
  }
  const payload = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: sessionJwtIssuer(),
    audience: sessionJwtAudience(),
  });
  if (payload?.typ !== 'access') {
    const error = new Error('Invalid access token.');
    error.code = 'auth/invalid-access-token';
    throw error;
  }
  return payload;
}

async function createSession({
  user,
  firebaseUid,
  deviceId,
  platform,
  metadata = {},
}) {
  if (!user && !firebaseUid) {
    throw new Error('Cannot create a session without a user.');
  }

  const resolvedUserId = toSafeString(user?.uid || user?.firebaseUid || firebaseUid);
  const resolvedDeviceId = toSafeString(deviceId) || generateDeviceId();
  const resolvedPlatform = toSafeString(platform) || 'unknown';
  const sessionId = generateSessionId();
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = new Date(Date.now() + (REFRESH_TOKEN_TTL_SECONDS * 1000));

  await AuthSession.create({
    sessionId,
    userId: resolvedUserId,
    deviceId: resolvedDeviceId,
    platform: resolvedPlatform,
    refreshTokenHash: hashToken(refreshToken),
    refreshTokenExpiresAt,
    metadata,
    lastUsedAt: new Date(),
  });

  logSecurityEvent('auth_session_created', {
    sessionId,
    userId: resolvedUserId,
    deviceId: resolvedDeviceId,
    platform: resolvedPlatform,
  });
  scheduleCleanup();

  return {
    accessToken: signAccessToken({ sessionId, user }),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    sessionId,
    deviceId: resolvedDeviceId,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  };
}

async function findActiveSessionByRefreshToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  return AuthSession.findOne({
    refreshTokenHash: tokenHash,
    revokedAt: null,
    refreshTokenExpiresAt: { $gt: new Date() },
  });
}

async function refreshSession({
  refreshToken,
  user,
  metadata = {},
}) {
  const session = await findActiveSessionByRefreshToken(refreshToken);
  if (!session) {
    const error = new Error('Invalid refresh token.');
    error.code = 'auth/invalid-refresh-token';
    throw error;
  }

  if (session.revokedAt) {
    const error = new Error('Refresh token revoked.');
    error.code = 'auth/refresh-token-revoked';
    throw error;
  }

  if (session.refreshTokenExpiresAt && session.refreshTokenExpiresAt <= new Date()) {
    const error = new Error('Refresh token expired.');
    error.code = 'auth/refresh-token-expired';
    throw error;
  }

  let effectiveUser = user;
  if (!effectiveUser) {
    const dbUser = await User.findOne({
      $or: [{ uid: session.userId }, { firebaseUid: session.userId }],
    });
    effectiveUser = dbUser
      ? dbUser.toObject?.() || dbUser
      : {
          uid: session.userId,
          firebaseUid: session.userId,
          role: 'customer',
          email: '',
          phone: '',
          isActive: true,
        };
  }

  if (effectiveUser.isDeleted === true || effectiveUser.isActive === false) {
    const error = new Error('Account is not available.');
    error.code = 'auth/account-disabled';
    throw error;
  }

  const nextRefreshToken = generateRefreshToken();
  const nextRefreshTokenExpiresAt = new Date(Date.now() + (REFRESH_TOKEN_TTL_SECONDS * 1000));
  session.refreshTokenHash = hashToken(nextRefreshToken);
  session.refreshTokenExpiresAt = nextRefreshTokenExpiresAt;
  session.lastUsedAt = new Date();
  session.accessTokenVersion += 1;
  session.metadata = {
    ...(session.metadata && typeof session.metadata === 'object' ? session.metadata : {}),
    ...metadata,
  };
  await session.save();
  logSecurityEvent('auth_session_rotated', {
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.deviceId,
  });
  scheduleCleanup();

  return {
    accessToken: signAccessToken({
      sessionId: session.sessionId,
      user: effectiveUser,
    }),
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: nextRefreshToken,
    refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    refreshTokenExpiresAt: nextRefreshTokenExpiresAt.toISOString(),
  };
}

async function revokeSessionBySessionId(sessionId) {
  const resolvedSessionId = toSafeString(sessionId);
  if (!resolvedSessionId) {
    return false;
  }
  const session = await AuthSession.findOne({ sessionId: resolvedSessionId });
  if (!session) {
    return false;
  }
  session.revokedAt = new Date();
  session.lastUsedAt = new Date();
  await session.save();
  logSecurityEvent('auth_session_revoked', {
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.deviceId,
    reason: 'session_id',
  });
  scheduleCleanup();
  return true;
}

async function revokeSessionByRefreshToken(refreshToken) {
  const session = await findActiveSessionByRefreshToken(refreshToken);
  if (!session) {
    return false;
  }
  session.revokedAt = new Date();
  session.lastUsedAt = new Date();
  await session.save();
  logSecurityEvent('auth_session_revoked', {
    sessionId: session.sessionId,
    userId: session.userId,
    deviceId: session.deviceId,
    reason: 'refresh_token',
  });
  scheduleCleanup();
  return true;
}

async function getSessionById(sessionId) {
  return AuthSession.findOne({ sessionId: toSafeString(sessionId) });
}

async function cleanupExpiredSessions() {
  const now = new Date();
  const revokedCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const result = await AuthSession.deleteMany({
    $or: [
      { refreshTokenExpiresAt: { $lte: now } },
      { revokedAt: { $lte: revokedCutoff } },
    ],
  });
  if (result.deletedCount) {
    logSecurityEvent('auth_session_cleanup', {
      deletedCount: result.deletedCount,
    });
  }
  return result;
}

module.exports = {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  createSession,
  cleanupExpiredSessions,
  refreshSession,
  revokeSessionBySessionId,
  revokeSessionByRefreshToken,
  getSessionById,
  verifyAccessToken,
  generateDeviceId,
};
