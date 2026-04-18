const Store = require('../models/Store');
const { isAllowedAdminEmail } = require('./authController');
const {
  getPricingConfig,
  listPricingAuditLogs,
  replacePricingConfig,
  updatePricingConfigSection,
} = require('../services/pricingConfigService');
const { calculateOrderPricing, toPricingEngineConfig } = require('../services/pricingService');

function ensurePricingAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function normalizeScope(scope) {
  const allowed = new Set([
    'commission',
    'deliveryFees',
    'trialPricing',
    'discounts',
    'riderPayouts',
    'dynamicRules',
  ]);
  return allowed.has(String(scope || '').trim()) ? String(scope).trim() : '';
}

function serializeAuditLog(log) {
  return {
    id: log.auditId || '',
    adminId: log.adminId || '',
    adminEmail: log.adminEmail || '',
    action: log.action || '',
    scope: log.scope || '',
    previousValue: log.previousValue || {},
    newValue: log.newValue || {},
    changedFields: Array.isArray(log.changedFields) ? log.changedFields : [],
    timestamp: log.timestampIso || log.createdAt || null,
  };
}

async function getAdminPricing(req, res, next) {
  try {
    if (!ensurePricingAdmin(req, res)) {
      return;
    }
    const [config, auditLogs] = await Promise.all([
      getPricingConfig(),
      listPricingAuditLogs(30),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        config,
        auditLogs: auditLogs.map(serializeAuditLog),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateAdminPricing(req, res, next) {
  try {
    if (!ensurePricingAdmin(req, res)) {
      return;
    }
    const updated = await replacePricingConfig({
      adminId: req.user.uid,
      adminEmail: req.user.email || '',
      updates: req.body || {},
      action: 'update_pricing_global',
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
}

function makeScopedUpdater(scope, action) {
  return async function scopedUpdate(req, res, next) {
    try {
      if (!ensurePricingAdmin(req, res)) {
        return;
      }
      const updated = await updatePricingConfigSection({
        adminId: req.user.uid,
        adminEmail: req.user.email || '',
        scope,
        updates: req.body || {},
        action,
      });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      return next(error);
    }
  };
}

async function updateAdminPricingScope(req, res, next) {
  try {
    if (!ensurePricingAdmin(req, res)) {
      return;
    }
    const scope = normalizeScope(req.body?.scope);
    if (!scope) {
      return res.status(400).json({ success: false, message: 'A valid pricing scope is required.' });
    }
    const updated = await updatePricingConfigSection({
      adminId: req.user.uid,
      adminEmail: req.user.email || '',
      scope,
      updates: req.body?.updates || {},
      action: `update_pricing_${scope}`,
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
}

async function simulateAdminPricing(req, res, next) {
  try {
    if (!ensurePricingAdmin(req, res)) {
      return;
    }
    const liveConfig = await getPricingConfig();
    const orderValue = Math.max(0, Number(req.body?.orderValue || 0));
    const distanceKm = Math.max(0, Number(req.body?.distance || 0));
    const taxAmount = Math.max(0, Number(req.body?.taxAmount || 0));
    const demandLevel = String(req.body?.demandLevel || '').trim().toLowerCase();
    const userType = String(req.body?.userType || 'new').trim().toLowerCase();
    const existingOrderCount =
      userType === 'repeat'
        ? 5
        : userType === 'loyal'
          ? 10
          : Number.isFinite(Number(req.body?.existingOrderCount))
            ? Number(req.body.existingOrderCount)
            : 0;
    const returnRate = Math.max(0, Math.min(1, Number(req.body?.returnRate ?? (userType === 'high_return' ? 0.4 : 0.12))));
    const conversionRate = Math.max(0, Math.min(1, Number(req.body?.conversionRate ?? (userType === 'low_conversion' ? 0.05 : 0.18))));
    const availableRiderCount = Math.max(0, Number(req.body?.availableRiderCount || 4));
    const activeDemandCount = Math.max(0, Number(req.body?.activeDemandCount || 10));
    const avgDemandScore =
      demandLevel === 'high'
        ? 90
        : demandLevel === 'elevated'
          ? 60
          : Number(req.body?.avgDemandScore || 30);
    const vendorId = String(req.body?.vendorId || '').trim();
    let store = null;
    if (vendorId) {
      store = await Store.findOne({
        $or: [{ ownerId: vendorId }, { _id: vendorId }],
      }).lean();
    }

    const simulation = calculateOrderPricing({
      orderValue,
      taxAmount,
      distanceKm,
      paymentMethod: String(req.body?.paymentMethod || 'RAZORPAY').trim().toUpperCase(),
      existingOrderCount,
      userBehaviorMetrics: {
        conversionRate,
        returnRate,
      },
      fulfillmentType: String(req.body?.fulfillmentType || 'marketplace').trim(),
      vendorType: store?.vendorType || 'standard_vendor',
      vendorId: store?.ownerId || vendorId,
      userId: String(req.body?.userId || 'simulation-user').trim(),
      storeCommissionRate: store?.commissionRate,
      storeRating: Number(req.body?.storeRating ?? store?.rating ?? 4.3),
      storeReviewCount: Number(req.body?.storeReviewCount ?? store?.reviewCount ?? 25),
      customVendorProfile: store?.customVendorProfile || {},
      availableRiderCount,
      activeDemandCount,
      avgDemandScore,
      avgFitRisk: Math.max(0, Math.min(1, Number(req.body?.avgFitRisk || 0.2))),
      tryAtHomeRequested: req.body?.tryAtHomeRequested === true,
      tryAtHomeSupported: req.body?.tryAtHomeSupported !== false,
      trialFee: Number(req.body?.trialFee || liveConfig.trialPricing?.trialFee || 99),
      config: toPricingEngineConfig(liveConfig),
    });

    return res.status(200).json({
      success: true,
      data: {
        inputs: {
          orderValue,
          distanceKm,
          taxAmount,
          demandLevel: demandLevel || 'normal',
          userType,
          availableRiderCount,
          activeDemandCount,
        },
        outputs: simulation,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getAdminPricing,
  simulateAdminPricing,
  updateAdminPricing,
  updateAdminPricingCommission: makeScopedUpdater('commission', 'update_pricing_commission'),
  updateAdminPricingDelivery: makeScopedUpdater('deliveryFees', 'update_pricing_delivery'),
  updateAdminPricingDiscount: makeScopedUpdater('discounts', 'update_pricing_discount'),
  updateAdminPricingRider: makeScopedUpdater('riderPayouts', 'update_pricing_rider'),
  updateAdminPricingScope,
  updateAdminPricingTrial: makeScopedUpdater('trialPricing', 'update_pricing_trial'),
};
