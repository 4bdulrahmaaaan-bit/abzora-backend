function normalizeRoles(user) {
  const roles = user?.roles;
  if (!roles) {
    return {};
  }
  if (roles instanceof Map) {
    return Object.fromEntries(roles.entries());
  }
  if (typeof roles === 'object') {
    return { ...roles };
  }
  return {};
}

function hasRole(user, allowedRoles = []) {
  const normalizedRole = String(user?.role || '').trim().toLowerCase();
  const normalizedAllowed = allowedRoles.map((role) => String(role).trim().toLowerCase());
  if (normalizedAllowed.includes(normalizedRole)) {
    return true;
  }
  const roleMap = normalizeRoles(user);
  return normalizedAllowed.some((role) => roleMap[role] === true);
}

function requireRoles(...allowedRoles) {
  return function requireRolesMiddleware(req, res, next) {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!hasRole(req.user, allowedRoles)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    return next();
  };
}

const requireAdmin = requireRoles('admin', 'super_admin');
const requireVendor = requireRoles('vendor', 'admin', 'super_admin');
const requireRider = requireRoles('rider', 'admin', 'super_admin');

module.exports = {
  hasRole,
  requireAdmin,
  requireRoles,
  requireRider,
  requireVendor,
};
