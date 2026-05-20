const { createRateLimiter } = require('./securityMiddleware');
const { hasRole } = require('./authorizationMiddleware');

const invoiceReadLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.INVOICE_READ_RATE_LIMIT_MAX || 120),
  message: 'Too many invoice requests. Please retry shortly.',
  keyGenerator: (req) => `invoice-read:${req.user?.uid || req.ip}:${req.path || req.originalUrl || ''}`,
});

const invoiceWriteLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.INVOICE_WRITE_RATE_LIMIT_MAX || 40),
  message: 'Too many invoice write actions. Please retry shortly.',
  keyGenerator: (req) => `invoice-write:${req.user?.uid || req.ip}:${req.path || req.originalUrl || ''}`,
});

function denyEnumeration(req, res, next) {
  res.locals.invoiceNotFoundMessage = 'Requested invoice resource is unavailable.';
  next();
}

function requireInvoiceAdminPermission(permission) {
  return (req, res, next) => {
    if (hasRole(req.user, ['super_admin'])) return next();
    if (!hasRole(req.user, ['admin'])) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const permissions = req.user?.permissions || {};
    const granted = permissions[permission] === true || permissions.invoices_all === true;
    if (!granted) {
      return res.status(403).json({ success: false, message: 'Admin permission denied.' });
    }
    return next();
  };
}

module.exports = {
  denyEnumeration,
  invoiceReadLimiter,
  invoiceWriteLimiter,
  requireInvoiceAdminPermission,
};
