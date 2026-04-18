function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function normalizeRatio(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return clamp(numeric, 0, 1);
}

function pricingConfig() {
  return {
    minDeliveryFee: Number(process.env.MIN_DELIVERY_FEE || 39),
    sameDayFeeShortKm: Number(process.env.SAME_DAY_FEE_SHORT_KM || 49),
    sameDayFeeMediumKm: Number(process.env.SAME_DAY_FEE_MEDIUM_KM || 69),
    sameDayFeeLongKm: Number(process.env.SAME_DAY_FEE_LONG_KM || 79),
    tryAtHomeFee: Number(process.env.TRY_AT_HOME_FEE || 99),
    firstOrderDiscountAmount: Number(process.env.FIRST_ORDER_DISCOUNT_AMOUNT || 100),
    firstOrderDiscountCapPercent: Number(process.env.FIRST_ORDER_DISCOUNT_CAP_PERCENT || 0.1),
    maxDiscountPercent: Number(process.env.MAX_DISCOUNT_PERCENT || 0.15),
    discountDisableAfterOrders: Number(process.env.DISCOUNT_DISABLE_AFTER_ORDERS || 3),
    standardCommissionDefault: Number(process.env.STANDARD_VENDOR_COMMISSION || 0.18),
    standardCommissionMin: Number(process.env.STANDARD_VENDOR_COMMISSION_MIN || 0.15),
    standardCommissionMax: Number(process.env.STANDARD_VENDOR_COMMISSION_MAX || 0.2),
    customCommissionDefault: Number(process.env.CUSTOM_VENDOR_COMMISSION || 0.24),
    customCommissionMin: Number(process.env.CUSTOM_VENDOR_COMMISSION_MIN || 0.2),
    customCommissionMax: Number(process.env.CUSTOM_VENDOR_COMMISSION_MAX || 0.3),
    maxCommissionPercent: Number(process.env.MAX_COMMISSION_PERCENT || 0.3),
    riderBasePayout: Number(process.env.RIDER_BASE_PAYOUT || 30),
    riderDistanceBonusNear: Number(process.env.RIDER_DISTANCE_BONUS_NEAR || 10),
    riderDistanceBonusMid: Number(process.env.RIDER_DISTANCE_BONUS_MID || 15),
    riderDistanceBonusFar: Number(process.env.RIDER_DISTANCE_BONUS_FAR || 20),
    riderPeakBonus: Number(process.env.RIDER_PEAK_BONUS || 10),
    riderTrialPayoutBase: Number(process.env.RIDER_TRIAL_PAYOUT_BASE || 60),
    riderTrialPayoutMax: Number(process.env.RIDER_TRIAL_PAYOUT_MAX || 80),
    riderLatePenaltyMild: Number(process.env.RIDER_LATE_PENALTY_MILD || 10),
    riderLatePenaltyHigh: Number(process.env.RIDER_LATE_PENALTY_HIGH || 20),
    minRiderPayout: Number(process.env.MIN_RIDER_PAYOUT || 30),
    paymentGatewayFeePercent: Number(process.env.PAYMENT_GATEWAY_FEE_PERCENT || 0.025),
    liveConfig: null,
  };
}

function toPricingEngineConfig(liveConfig = null) {
  const defaults = pricingConfig();
  if (!liveConfig || typeof liveConfig !== 'object') {
    return defaults;
  }
  return {
    ...defaults,
    liveConfig,
    minDeliveryFee: Number(liveConfig.deliveryFees?.minDeliveryFee ?? defaults.minDeliveryFee),
    sameDayFeeShortKm: Number(liveConfig.deliveryFees?.slabUpTo2Km ?? defaults.sameDayFeeShortKm),
    sameDayFeeMediumKm: Number(liveConfig.deliveryFees?.slab2To5Km ?? defaults.sameDayFeeMediumKm),
    sameDayFeeLongKm: Number(liveConfig.deliveryFees?.slabAbove5Km ?? defaults.sameDayFeeLongKm),
    tryAtHomeFee: Number(liveConfig.trialPricing?.trialFee ?? defaults.tryAtHomeFee),
    firstOrderDiscountAmount: Number(liveConfig.discounts?.firstOrderDiscount ?? defaults.firstOrderDiscountAmount),
    firstOrderDiscountCapPercent: Number(
      liveConfig.discounts?.maxDiscountPercent ?? defaults.firstOrderDiscountCapPercent,
    ),
    maxDiscountPercent: Number(liveConfig.discounts?.maxDiscountPercent ?? defaults.maxDiscountPercent),
    discountDisableAfterOrders: Number(
      liveConfig.discounts?.disableAfterOrders ?? defaults.discountDisableAfterOrders,
    ),
    standardCommissionDefault: Number(
      liveConfig.commission?.defaultCommissionReadyMade ?? defaults.standardCommissionDefault,
    ),
    customCommissionDefault: Number(
      liveConfig.commission?.defaultCommissionCustom ?? defaults.customCommissionDefault,
    ),
    riderBasePayout: Number(liveConfig.riderPayouts?.basePayout ?? defaults.riderBasePayout),
    riderDistanceBonusNear: Number(liveConfig.riderPayouts?.distanceBonusNear ?? defaults.riderDistanceBonusNear),
    riderDistanceBonusMid: Number(liveConfig.riderPayouts?.distanceBonusMid ?? defaults.riderDistanceBonusMid),
    riderDistanceBonusFar: Number(liveConfig.riderPayouts?.distanceBonusFar ?? defaults.riderDistanceBonusFar),
    riderPeakBonus: Number(liveConfig.riderPayouts?.peakBonus ?? defaults.riderPeakBonus),
    riderTrialPayoutBase: Number(liveConfig.riderPayouts?.trialPayoutBase ?? defaults.riderTrialPayoutBase),
    riderTrialPayoutMax: Number(liveConfig.riderPayouts?.trialPayoutMax ?? defaults.riderTrialPayoutMax),
    riderLatePenaltyMild: Number(liveConfig.riderPayouts?.latePenaltyMild ?? defaults.riderLatePenaltyMild),
    riderLatePenaltyHigh: Number(liveConfig.riderPayouts?.latePenaltyHigh ?? defaults.riderLatePenaltyHigh),
    minRiderPayout: Number(liveConfig.riderPayouts?.minPayout ?? defaults.minRiderPayout),
  };
}

function getBaseDeliveryFee(distanceKm, config = pricingConfig()) {
  const safeDistance = Math.max(0, Number(distanceKm || 0));
  if (safeDistance <= 2) {
    return config.sameDayFeeShortKm;
  }
  if (safeDistance <= 5) {
    return config.sameDayFeeMediumKm;
  }
  return config.sameDayFeeLongKm;
}

function isPeakHour(date = new Date()) {
  const hour = date.getHours();
  return (hour >= 12 && hour < 14) || (hour >= 18 && hour < 21);
}

function calculateDemandAdjustment({ demandLevel = 'normal', lowRiderSupply = false }) {
  if (!lowRiderSupply) {
    return { surchargeRate: 0, reason: '' };
  }
  if (demandLevel === 'high') {
    return { surchargeRate: 0.15, reason: 'high_demand_low_riders' };
  }
  if (demandLevel === 'elevated') {
    return { surchargeRate: 0.1, reason: 'elevated_demand_low_riders' };
  }
  return { surchargeRate: 0, reason: '' };
}

function calculateDeliveryFee({
  distanceKm,
  demandLevel,
  availableRiderCount = 0,
  activeDemandCount = 0,
  userConversionRate = 0,
  config = pricingConfig(),
  pricingDate = new Date(),
}) {
  const baseFee = getBaseDeliveryFee(distanceKm, config);
  const lowRiderThreshold = Number(
    config.liveConfig?.dynamicRules?.lowRiderThreshold ?? Math.max(1, Math.ceil(Number(activeDemandCount || 0) / 3)),
  );
  const lowRiderSupply = Number(availableRiderCount || 0) <= lowRiderThreshold;
  const demandAdjustment =
    config.liveConfig?.deliveryFees?.surgeEnabled === false ||
    config.liveConfig?.dynamicRules?.highDemandLowRidersEnabled === false
      ? { surchargeRate: 0, reason: '' }
      : calculateDemandAdjustment({ demandLevel, lowRiderSupply });
  let dynamicFee = roundMoney(baseFee * (1 + demandAdjustment.surchargeRate));

  if (isPeakHour(pricingDate) && Number(config.liveConfig?.deliveryFees?.peakHourAdjustment || 0) > 0) {
    dynamicFee = roundMoney(dynamicFee + Number(config.liveConfig.deliveryFees.peakHourAdjustment || 0));
  }

  let conversionRelief = 0;
  if (
    config.liveConfig?.dynamicRules?.lowConversionBoostEnabled !== false &&
    normalizeRatio(userConversionRate, 0) <
      Number(config.liveConfig?.dynamicRules?.lowConversionThreshold ?? 0.12)
  ) {
    conversionRelief = dynamicFee <= 49 ? 5 : 10;
    dynamicFee = Math.max(config.minDeliveryFee, roundMoney(dynamicFee - conversionRelief));
  }

  return {
    baseFee: roundMoney(baseFee),
    finalFee: roundMoney(Math.max(config.minDeliveryFee, dynamicFee)),
    surchargeRate: demandAdjustment.surchargeRate,
    surchargeReason: demandAdjustment.reason,
    conversionRelief: roundMoney(conversionRelief),
  };
}

function calculateDiscount({
  orderValue,
  existingOrderCount = 0,
  userConversionRate = 0,
  userId = '',
  vendorId = '',
  config = pricingConfig(),
}) {
  const safeOrderValue = roundMoney(orderValue);
  const targetedUsers = Array.isArray(config.liveConfig?.discounts?.targetUserIds)
    ? config.liveConfig.discounts.targetUserIds
    : [];
  const targetedVendors = Array.isArray(config.liveConfig?.discounts?.targetVendorIds)
    ? config.liveConfig.discounts.targetVendorIds
    : [];
  const isTargeted =
    targetedUsers.length === 0 && targetedVendors.length === 0
      ? true
      : targetedUsers.includes(String(userId || '').trim()) ||
        targetedVendors.includes(String(vendorId || '').trim());
  const disableDiscounts = Number(existingOrderCount || 0) > config.discountDisableAfterOrders;
  const hardCapAmount = roundMoney(
    Math.min(
      safeOrderValue * config.maxDiscountPercent,
      Number(config.liveConfig?.discounts?.maxDiscountCap ?? safeOrderValue * config.maxDiscountPercent),
    ),
  );

  if (
    config.liveConfig?.discounts?.discountsEnabled === false ||
    !isTargeted ||
    disableDiscounts ||
    safeOrderValue <= 0
  ) {
    return {
      amount: 0,
      percentOfOrder: 0,
      disabled: true,
      reason:
        config.liveConfig?.discounts?.discountsEnabled === false
          ? 'disabled_by_admin'
          : !isTargeted
            ? 'not_targeted'
            : disableDiscounts
              ? 'repeat_rate_limit'
              : 'not_applicable',
    };
  }

  let discountAmount = 0;
  let reason = 'eligible';
  const firstOrderCap = roundMoney(safeOrderValue * config.firstOrderDiscountCapPercent);

  if (Number(existingOrderCount || 0) === 0) {
    discountAmount = Math.min(config.firstOrderDiscountAmount, firstOrderCap);
    reason = 'first_order';
  } else if (normalizeRatio(userConversionRate, 0) < 0.08) {
    discountAmount = roundMoney(Math.min(safeOrderValue * 0.03, hardCapAmount));
    reason = 'conversion_recovery';
  }

  discountAmount = roundMoney(Math.min(discountAmount, hardCapAmount));
  return {
    amount: discountAmount,
    percentOfOrder: safeOrderValue > 0 ? roundMoney(discountAmount / safeOrderValue) : 0,
    disabled: false,
    reason,
  };
}

function liveConfigVendorOverride({ liveConfig, vendorId }) {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId) {
    return null;
  }
  const overrides = liveConfig?.commission?.perVendorOverrides || {};
  const directValue = overrides instanceof Map ? overrides.get(normalizedVendorId) : overrides[normalizedVendorId];
  const parsed = Number(directValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateVendorCommission({
  fulfillmentType = 'marketplace',
  vendorType = 'standard_vendor',
  storeCommissionRate,
  storeRating = 0,
  storeReviewCount = 0,
  customVendorProfile = {},
  vendorId = '',
  config = pricingConfig(),
}) {
  const isCustom = fulfillmentType === 'custom_tailoring' || vendorType === 'custom_vendor';
  const defaultBase = isCustom ? config.customCommissionDefault : config.standardCommissionDefault;
  const minRate = isCustom ? config.customCommissionMin : config.standardCommissionMin;
  const maxRate = Math.min(
    config.maxCommissionPercent,
    isCustom ? config.customCommissionMax : config.standardCommissionMax,
  );
  const quality = customVendorProfile?.quality || {};
  const metrics = customVendorProfile?.metrics || {};

  let rate = Number.isFinite(Number(storeCommissionRate)) && Number(storeCommissionRate) > 0
    ? Number(storeCommissionRate)
    : defaultBase;
  const reasons = [];
  const liveOverride = liveConfigVendorOverride({
    liveConfig: config.liveConfig,
    vendorId,
  });
  if (liveOverride != null) {
    rate = liveOverride;
    reasons.push('vendor_override');
  }

  const totalOrders = isCustom
    ? Number(metrics.totalCustomOrders || 0)
    : Number(storeReviewCount || 0);

  if (totalOrders < 10) {
    rate = minRate;
    reasons.push('new_vendor_rate');
  }

  const onTimeRate = isCustom
    ? normalizeRatio(quality.onTimeDeliveryRate, 0)
    : storeRating >= 4.2
      ? 0.95
      : 0.88;
  const returnRate = isCustom
    ? normalizeRatio(metrics.returnRate, 0)
    : storeRating >= 4.2
      ? 0.08
      : 0.16;
  const highPerformer =
    Number(storeRating || 0) >= 4.6 &&
    onTimeRate >= 0.95 &&
    returnRate <= 0.08;
  const poorSla = onTimeRate < 0.88 || normalizeRatio(metrics.delayRate, 0) > 0.12;

  if (highPerformer) {
    rate += Number(config.liveConfig?.commission?.highPerformerAdjustment ?? (isCustom ? -0.02 : -0.03));
    reasons.push('high_performance_reduction');
  }
  if (poorSla) {
    rate += Number(config.liveConfig?.commission?.lowSlaAdjustment ?? (isCustom ? 0.03 : 0.05));
    reasons.push('sla_penalty_increase');
  }

  rate = clamp(rate, minRate, maxRate);
  return {
    rate,
    reasons,
  };
}

function calculateRiderPayout({
  distanceKm,
  isTrialDelivery = false,
  peakHour = false,
  latenessMinutes = 0,
  config = pricingConfig(),
}) {
  const safeDistance = Math.max(0, Number(distanceKm || 0));
  const distanceBonus =
    safeDistance <= 2
      ? config.riderDistanceBonusNear
      : safeDistance <= 5
        ? config.riderDistanceBonusMid
        : config.riderDistanceBonusFar;
  const peakBonus = peakHour ? config.riderPeakBonus : 0;
  const latePenalty =
    Number(latenessMinutes || 0) >= 45
      ? config.riderLatePenaltyHigh
      : Number(latenessMinutes || 0) >= 15
        ? config.riderLatePenaltyMild
        : 0;

  if (isTrialDelivery) {
    const rawTrialPayout = roundMoney(
      config.riderTrialPayoutBase +
      (distanceBonus - config.riderDistanceBonusNear) +
      peakBonus -
      latePenalty,
    );
    return {
      basePayout: config.riderTrialPayoutBase,
      distanceBonus,
      peakBonus,
      penalty: latePenalty,
      totalPayout: roundMoney(clamp(rawTrialPayout, config.riderTrialPayoutBase, config.riderTrialPayoutMax)),
    };
  }

  const rawPayout = config.riderBasePayout + distanceBonus + peakBonus - latePenalty;
  return {
    basePayout: config.riderBasePayout,
    distanceBonus,
    peakBonus,
    penalty: latePenalty,
    totalPayout: roundMoney(Math.max(config.minRiderPayout, rawPayout)),
  };
}

function inferDemandLevel(avgDemandScore = 0, activeDemandCount = 0) {
  const demandScore = Number(avgDemandScore || 0);
  const activeCount = Number(activeDemandCount || 0);
  if (demandScore >= 75 || activeCount >= 20) {
    return 'high';
  }
  if (demandScore >= 45 || activeCount >= 8) {
    return 'elevated';
  }
  return 'normal';
}

function calculatePlatformEconomics({
  orderValue,
  commissionAmount,
  deliveryFee,
  tryAtHomeFee = 0,
  riderPayout,
  discountAmount = 0,
  paymentGatewayFee = 0,
  vendorPenaltyAmount = 0,
  restockingFee = 0,
  returned = false,
}) {
  const revenue = roundMoney(
    Number(commissionAmount || 0) +
      Number(deliveryFee || 0) +
      Number(tryAtHomeFee || 0) +
      Number(vendorPenaltyAmount || 0) +
      Number(restockingFee || 0),
  );
  const cost = roundMoney(
    Number(riderPayout || 0) +
      Number(discountAmount || 0) +
      Number(paymentGatewayFee || 0),
  );
  const returnLoss = returned
    ? roundMoney(Number(deliveryFee || 0) + Number(riderPayout || 0))
    : 0;

  return {
    orderValue: roundMoney(orderValue),
    platformRevenue: revenue,
    platformCost: cost,
    returnLoss,
    platformProfit: roundMoney(revenue - cost - returnLoss),
  };
}

function buildCustomerMessaging({ totalAmount, deliveryFee, tryAtHomeFee, tryAtHomeRecommended }) {
  return {
    displayPriceLabel: `Price: Rs ${roundMoney(totalAmount)}`,
    deliveryLabel: `Delivered today for Rs ${roundMoney(deliveryFee)} ⚡`,
    tryAtHomeLabel: `Try at home Rs ${roundMoney(tryAtHomeFee)} (pay after)`,
    ctas: ['Buy Now', 'Try at Home'],
    recommendedExperience: tryAtHomeRecommended ? 'try_at_home' : 'buy_now',
  };
}

function calculateOrderPricing({
  orderValue,
  taxAmount = 0,
  distanceKm = 0,
  paymentMethod = 'RAZORPAY',
  existingOrderCount = 0,
  userBehaviorMetrics = {},
  fulfillmentType = 'marketplace',
  vendorType = 'standard_vendor',
  storeCommissionRate,
  storeRating = 0,
  storeReviewCount = 0,
  customVendorProfile = {},
  vendorId = '',
  userId = '',
  availableRiderCount = 0,
  activeDemandCount = 0,
  avgDemandScore = 0,
  avgFitRisk = 0,
  tryAtHomeRequested = false,
  tryAtHomeSupported = false,
  trialFee,
  latenessMinutes = 0,
  vendorPenaltyAmount = 0,
  restockingFee = 0,
  returned = false,
  pricingDate = new Date(),
  config = pricingConfig(),
}) {
  const safeOrderValue = roundMoney(orderValue);
  const safeTax = roundMoney(taxAmount);
  const safeDistance = Math.max(0, Number(distanceKm || 0));
  const demandLevel = inferDemandLevel(avgDemandScore, activeDemandCount);
  const conversionRate = normalizeRatio(userBehaviorMetrics?.conversionRate, 0);
  const userReturnRate = normalizeRatio(userBehaviorMetrics?.returnRate, 0);
  const trialRecommended =
    Boolean(tryAtHomeSupported) &&
    config.liveConfig?.dynamicRules?.highReturnPromoteTrialEnabled !== false &&
    (normalizeRatio(avgFitRisk, 0) >= Number(config.liveConfig?.dynamicRules?.highReturnThreshold ?? 0.55) ||
      userReturnRate >= Number(config.liveConfig?.dynamicRules?.highReturnThreshold ?? 0.3));
  const tryAtHomeFee = tryAtHomeRequested || trialRecommended
    ? roundMoney(Number(trialFee ?? config.tryAtHomeFee))
    : 0;

  const discount = calculateDiscount({
    orderValue: safeOrderValue,
    existingOrderCount,
    userConversionRate: conversionRate,
    userId,
    vendorId,
    config,
  });
  const delivery = calculateDeliveryFee({
    distanceKm: safeDistance,
    demandLevel,
    availableRiderCount,
    activeDemandCount,
    userConversionRate: conversionRate,
    config,
    pricingDate,
  });
  const commission = calculateVendorCommission({
    fulfillmentType,
    vendorType,
    storeCommissionRate,
    storeRating,
    storeReviewCount,
    customVendorProfile,
    vendorId,
    config,
  });
  const rider = calculateRiderPayout({
    distanceKm: safeDistance,
    isTrialDelivery: tryAtHomeRequested,
    peakHour: isPeakHour(pricingDate),
    latenessMinutes,
    config,
  });

  const platformCommission = roundMoney(safeOrderValue * commission.rate);
  const vendorPayout = roundMoney(
    Math.max(0, safeOrderValue - platformCommission - Math.max(0, Number(vendorPenaltyAmount || 0))),
  );
  const paymentGatewayFee = String(paymentMethod || '').toUpperCase() === 'RAZORPAY'
    ? roundMoney((safeOrderValue + delivery.finalFee + tryAtHomeFee - discount.amount) * config.paymentGatewayFeePercent)
    : 0;
  const totalAmount = roundMoney(
    Math.max(0, safeOrderValue + safeTax + delivery.finalFee + tryAtHomeFee - discount.amount),
  );

  const economics = calculatePlatformEconomics({
    orderValue: safeOrderValue,
    commissionAmount: platformCommission,
    deliveryFee: delivery.finalFee,
    tryAtHomeFee,
    riderPayout: rider.totalPayout,
    discountAmount: discount.amount,
    paymentGatewayFee,
    vendorPenaltyAmount,
    restockingFee,
    returned,
  });

  return {
    productAmount: safeOrderValue,
    subtotalAmount: safeOrderValue,
    taxAmount: safeTax,
    deliveryFee: delivery.finalFee,
    deliveryDistanceKm: safeDistance,
    discountAmount: discount.amount,
    discountPercent: discount.percentOfOrder,
    tryAtHomeFee,
    tryAtHomeFeeRefundable: tryAtHomeRequested || trialRecommended,
    commissionPercent: commission.rate,
    platformCommission,
    vendorEarnings: vendorPayout,
    riderEarnings: rider.totalPayout,
    totalAmount,
    paymentGatewayFee,
    platformRevenue: economics.platformRevenue,
    platformCost: economics.platformCost,
    platformProfit: economics.platformProfit,
    pricingBreakdown: {
      demandLevel,
      delivery,
      discount,
      commission,
      rider,
      returnLoss: economics.returnLoss,
      tryAtHomeRecommended: trialRecommended,
      customerMessaging: buildCustomerMessaging({
        totalAmount,
        deliveryFee: delivery.finalFee,
        tryAtHomeFee: roundMoney(Number(trialFee ?? config.tryAtHomeFee)),
        tryAtHomeRecommended: trialRecommended,
      }),
    },
  };
}

module.exports = {
  calculateOrderPricing,
  calculatePlatformEconomics,
  pricingConfig,
  roundMoney,
  toPricingEngineConfig,
};
