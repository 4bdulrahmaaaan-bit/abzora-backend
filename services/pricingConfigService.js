const { EventEmitter } = require('events');

const PricingConfig = require('../models/PricingConfig');
const PricingAuditLog = require('../models/PricingAuditLog');
const AdminActivityLog = require('../models/AdminActivityLog');
const { getJson, setJson, delPattern } = require('./redisCacheService');

const PRICING_CONFIG_CACHE_KEY = 'pricing-config:global';
const PRICING_EVENT_CHANNEL = 'pricing_config_updated';
const localPricingBus = new EventEmitter();
localPricingBus.setMaxListeners(100);

const DEFAULT_PRICING_CONFIG = Object.freeze({
  commission: {
    defaultCommissionReadyMade: 0.18,
    defaultCommissionCustom: 0.24,
    highPerformerAdjustment: -0.03,
    lowSlaAdjustment: 0.05,
    perVendorOverrides: {},
  },
  deliveryFees: {
    minDeliveryFee: 39,
    slabUpTo2Km: 49,
    slab2To5Km: 69,
    slabAbove5Km: 79,
    surgeEnabled: true,
    surgeMultiplier: 1.15,
    peakHourAdjustment: 10,
  },
  trialPricing: {
    trialFee: 99,
    refundable: true,
    waiveOnPurchase: true,
  },
  discounts: {
    discountsEnabled: true,
    firstOrderDiscount: 100,
    maxDiscountPercent: 0.1,
    maxDiscountCap: 300,
    disableAfterOrders: 3,
    targetUserIds: [],
    targetVendorIds: [],
  },
  riderPayouts: {
    basePayout: 30,
    distanceBonusNear: 10,
    distanceBonusMid: 15,
    distanceBonusFar: 20,
    peakBonus: 10,
    trialPayoutBase: 60,
    trialPayoutMax: 80,
    latePenaltyMild: 10,
    latePenaltyHigh: 20,
    minPayout: 30,
  },
  dynamicRules: {
    highDemandLowRidersEnabled: true,
    lowConversionBoostEnabled: true,
    highReturnPromoteTrialEnabled: true,
    highDemandThreshold: 75,
    lowRiderThreshold: 3,
    lowConversionThreshold: 0.12,
    highReturnThreshold: 0.3,
  },
});

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeObjects(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return clone(base);
  }
  const merged = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      merged[key] = mergeObjects(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function normalizePercent(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeAmount(value, fallback, min = 0, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return [...new Set(
    value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, 100),
  )];
}

function normalizePerVendorOverrides(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, rate]) => [String(key || '').trim(), normalizePercent(rate, null, 0.15, 0.3)])
      .filter(([key, rate]) => key && rate != null),
  );
}

function normalizePricingConfig(input = {}) {
  const base = mergeObjects(DEFAULT_PRICING_CONFIG, input);
  return {
    commission: {
      defaultCommissionReadyMade: normalizePercent(base.commission?.defaultCommissionReadyMade, 0.18, 0.15, 0.2),
      defaultCommissionCustom: normalizePercent(base.commission?.defaultCommissionCustom, 0.24, 0.2, 0.3),
      highPerformerAdjustment: normalizePercent(base.commission?.highPerformerAdjustment, -0.03, -0.05, 0),
      lowSlaAdjustment: normalizePercent(base.commission?.lowSlaAdjustment, 0.05, 0, 0.05),
      perVendorOverrides: normalizePerVendorOverrides(base.commission?.perVendorOverrides, {}),
    },
    deliveryFees: {
      minDeliveryFee: normalizeAmount(base.deliveryFees?.minDeliveryFee, 39, 0, 500),
      slabUpTo2Km: normalizeAmount(base.deliveryFees?.slabUpTo2Km, 49, 0, 500),
      slab2To5Km: normalizeAmount(base.deliveryFees?.slab2To5Km, 69, 0, 500),
      slabAbove5Km: normalizeAmount(base.deliveryFees?.slabAbove5Km, 79, 0, 500),
      surgeEnabled: base.deliveryFees?.surgeEnabled !== false,
      surgeMultiplier: normalizePercent(base.deliveryFees?.surgeMultiplier, 1.15, 1, 1.5),
      peakHourAdjustment: normalizeAmount(base.deliveryFees?.peakHourAdjustment, 10, 0, 100),
    },
    trialPricing: {
      trialFee: normalizeAmount(base.trialPricing?.trialFee, 99, 0, 5000),
      refundable: base.trialPricing?.refundable !== false,
      waiveOnPurchase: base.trialPricing?.waiveOnPurchase !== false,
    },
    discounts: {
      discountsEnabled: base.discounts?.discountsEnabled !== false,
      firstOrderDiscount: normalizeAmount(base.discounts?.firstOrderDiscount, 100, 0, 10000),
      maxDiscountPercent: normalizePercent(base.discounts?.maxDiscountPercent, 0.1, 0.1, 0.15),
      maxDiscountCap: normalizeAmount(base.discounts?.maxDiscountCap, 300, 0, 10000),
      disableAfterOrders: normalizeAmount(base.discounts?.disableAfterOrders, 3, 0, 50),
      targetUserIds: normalizeStringArray(base.discounts?.targetUserIds, []),
      targetVendorIds: normalizeStringArray(base.discounts?.targetVendorIds, []),
    },
    riderPayouts: {
      basePayout: normalizeAmount(base.riderPayouts?.basePayout, 30, 30, 1000),
      distanceBonusNear: normalizeAmount(base.riderPayouts?.distanceBonusNear, 10, 0, 200),
      distanceBonusMid: normalizeAmount(base.riderPayouts?.distanceBonusMid, 15, 0, 200),
      distanceBonusFar: normalizeAmount(base.riderPayouts?.distanceBonusFar, 20, 0, 200),
      peakBonus: normalizeAmount(base.riderPayouts?.peakBonus, 10, 0, 200),
      trialPayoutBase: normalizeAmount(base.riderPayouts?.trialPayoutBase, 60, 60, 500),
      trialPayoutMax: normalizeAmount(base.riderPayouts?.trialPayoutMax, 80, 60, 500),
      latePenaltyMild: normalizeAmount(base.riderPayouts?.latePenaltyMild, 10, 0, 100),
      latePenaltyHigh: normalizeAmount(base.riderPayouts?.latePenaltyHigh, 20, 0, 100),
      minPayout: normalizeAmount(base.riderPayouts?.minPayout, 30, 30, 1000),
    },
    dynamicRules: {
      highDemandLowRidersEnabled: base.dynamicRules?.highDemandLowRidersEnabled !== false,
      lowConversionBoostEnabled: base.dynamicRules?.lowConversionBoostEnabled !== false,
      highReturnPromoteTrialEnabled: base.dynamicRules?.highReturnPromoteTrialEnabled !== false,
      highDemandThreshold: normalizeAmount(base.dynamicRules?.highDemandThreshold, 75, 0, 100),
      lowRiderThreshold: normalizeAmount(base.dynamicRules?.lowRiderThreshold, 3, 0, 1000),
      lowConversionThreshold: normalizePercent(base.dynamicRules?.lowConversionThreshold, 0.12, 0, 1),
      highReturnThreshold: normalizePercent(base.dynamicRules?.highReturnThreshold, 0.3, 0, 1),
    },
  };
}

function flattenChangedFields(previousValue, nextValue, prefix = '') {
  const fields = new Set();
  const keys = new Set([
    ...Object.keys(previousValue || {}),
    ...Object.keys(nextValue || {}),
  ]);
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const before = previousValue?.[key];
    const after = nextValue?.[key];
    if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      !Array.isArray(before) &&
      !Array.isArray(after)
    ) {
      for (const nested of flattenChangedFields(before, after, path)) {
        fields.add(nested);
      }
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      fields.add(path);
    }
  }
  return [...fields];
}

function serializePricingConfig(document) {
  const source = typeof document?.toObject === 'function' ? document.toObject() : document;
  const normalized = normalizePricingConfig(source || {});
  return {
    ...normalized,
    updatedAt: source?.updatedAt || null,
    updatedBy: source?.updatedBy || '',
    updateSource: source?.updateSource || 'system',
  };
}

async function getOrCreatePricingConfig() {
  let config = await PricingConfig.findOne({ key: 'global-pricing' });
  if (!config) {
    config = await PricingConfig.create({
      key: 'global-pricing',
      ...normalizePricingConfig(DEFAULT_PRICING_CONFIG),
      updateSource: 'bootstrap',
    });
  }
  return config;
}

async function getPricingConfig({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await getJson(PRICING_CONFIG_CACHE_KEY);
    if (cached) {
      return normalizePricingConfig(cached);
    }
  }
  const config = await getOrCreatePricingConfig();
  const serialized = serializePricingConfig(config);
  await setJson(PRICING_CONFIG_CACHE_KEY, serialized, 300);
  return serialized;
}

async function recordPricingAudit({
  adminId,
  adminEmail = '',
  action,
  scope,
  previousValue,
  newValue,
}) {
  const changedFields = flattenChangedFields(previousValue, newValue);
  const timestampIso = nowIso();
  await PricingAuditLog.create({
    auditId: `pricing-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    adminId,
    adminEmail,
    action,
    scope,
    previousValue,
    newValue,
    changedFields,
    timestampIso,
  });
  await AdminActivityLog.create({
    logId: `admin-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actorId: adminId,
    actorRole: 'admin',
    action,
    targetType: 'pricing_config',
    targetId: scope,
    message: `Updated pricing configuration for ${scope}.`,
    timestampIso,
  });
}

async function publishPricingUpdate(payload) {
  localPricingBus.emit(PRICING_EVENT_CHANNEL, payload);
}

async function updatePricingConfigSection({
  adminId,
  adminEmail = '',
  scope,
  updates,
  action = 'update_pricing',
}) {
  const config = await getOrCreatePricingConfig();
  const current = serializePricingConfig(config);
  const next = clone(current);
  next[scope] = normalizePricingConfig({
    [scope]: {
      ...(current[scope] || {}),
      ...(updates || {}),
    },
  })[scope];

  config[scope] = next[scope];
  config.updatedBy = adminId;
  config.updateSource = action;
  await config.save();

  const serialized = serializePricingConfig(config);
  await delPattern('pricing-config:*');
  await setJson(PRICING_CONFIG_CACHE_KEY, serialized, 300);
  await recordPricingAudit({
    adminId,
    adminEmail,
    action,
    scope,
    previousValue: current[scope],
    newValue: serialized[scope],
  });
  await publishPricingUpdate({
    eventType: PRICING_EVENT_CHANNEL,
    scope,
    config: serialized,
    updatedAt: nowIso(),
    updatedBy: adminId,
  });
  return serialized;
}

async function replacePricingConfig({
  adminId,
  adminEmail = '',
  updates,
  action = 'replace_pricing',
}) {
  const config = await getOrCreatePricingConfig();
  const current = serializePricingConfig(config);
  const normalized = normalizePricingConfig(updates);

  config.commission = normalized.commission;
  config.deliveryFees = normalized.deliveryFees;
  config.trialPricing = normalized.trialPricing;
  config.discounts = normalized.discounts;
  config.riderPayouts = normalized.riderPayouts;
  config.dynamicRules = normalized.dynamicRules;
  config.updatedBy = adminId;
  config.updateSource = action;
  await config.save();

  const serialized = serializePricingConfig(config);
  await delPattern('pricing-config:*');
  await setJson(PRICING_CONFIG_CACHE_KEY, serialized, 300);
  await recordPricingAudit({
    adminId,
    adminEmail,
    action,
    scope: 'global',
    previousValue: current,
    newValue: serialized,
  });
  await publishPricingUpdate({
    eventType: PRICING_EVENT_CHANNEL,
    scope: 'global',
    config: serialized,
    updatedAt: nowIso(),
    updatedBy: adminId,
  });
  return serialized;
}

async function listPricingAuditLogs(limit = 50) {
  return PricingAuditLog.find({})
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(200, Number(limit || 50))))
    .lean();
}

module.exports = {
  DEFAULT_PRICING_CONFIG,
  getPricingConfig,
  listPricingAuditLogs,
  localPricingBus,
  normalizePricingConfig,
  PRICING_EVENT_CHANNEL,
  replacePricingConfig,
  serializePricingConfig,
  updatePricingConfigSection,
};
