function normalizeText(value) {
  return value == null ? '' : value.toString().trim().toLowerCase();
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeProximityScore(store, context) {
  const userLat = Number(context.latitude);
  const userLon = Number(context.longitude);
  const storeLat = Number(store.latitude);
  const storeLon = Number(store.longitude);
  if (
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLon) ||
    !Number.isFinite(storeLat) ||
    !Number.isFinite(storeLon)
  ) {
    return 0.5;
  }
  const distanceKm = haversineKm(userLat, userLon, storeLat, storeLon);
  return clamp(1 - distanceKm / 25);
}

function computeSuccessRateScore(store) {
  const metrics = store.customVendorProfile?.metrics || {};
  const explicit = Number(metrics.orderSuccessRate || 0);
  if (explicit > 0) {
    return clamp(explicit);
  }
  const completed = Number(metrics.completedCustomOrders || 0);
  const total = Number(metrics.totalCustomOrders || 0);
  if (total <= 0) {
    return 0.7;
  }
  return clamp(completed / total);
}

function computeDeliverySpeedScore(store, context) {
  const productionDays = Number(store.customVendorProfile?.productionTimeDays || 7);
  const desiredDays = Number(context.deliveryDays);
  if (Number.isFinite(desiredDays) && desiredDays > 0) {
    if (productionDays <= desiredDays) {
      return clamp(1 - (desiredDays - productionDays) * 0.05);
    }
    return clamp(1 - (productionDays - desiredDays) / Math.max(desiredDays, 1));
  }
  return clamp(1 - (productionDays - 2) / 12);
}

function computePriceMatchScore(store, context) {
  const minPrice = Number(store.customVendorProfile?.priceRangeMin || 0);
  const maxPrice = Number(store.customVendorProfile?.priceRangeMax || minPrice || 0);
  const budgetMin = Number(context.budgetMin);
  const budgetMax = Number(context.budgetMax);

  if (
    Number.isFinite(budgetMin) &&
    Number.isFinite(budgetMax) &&
    budgetMax > 0 &&
    minPrice <= budgetMax &&
    maxPrice >= budgetMin
  ) {
    const vendorMid = (minPrice + maxPrice) / 2;
    const budgetMid = (budgetMin + budgetMax) / 2;
    return clamp(1 - Math.abs(vendorMid - budgetMid) / Math.max(budgetMid, 1));
  }

  if (Number.isFinite(budgetMax) && budgetMax > 0) {
    return minPrice <= budgetMax
      ? clamp(1 - Math.abs(minPrice - budgetMax) / Math.max(budgetMax, 1))
      : clamp(1 - (minPrice - budgetMax) / Math.max(budgetMax, 1));
  }

  return 0.65;
}

function computeCategoryBoost(store, context) {
  const requestedCategory = normalizeText(context.category);
  const requestedStyle = normalizeText(context.style);
  const specializations = (store.customVendorProfile?.specializations || []).map(normalizeText);
  let boost = 0;
  if (
    requestedCategory &&
    specializations.some((item) => item.includes(requestedCategory) || requestedCategory.includes(item))
  ) {
    boost += 0.1;
  }
  if (
    requestedStyle &&
    specializations.some((item) => item.includes(requestedStyle) || requestedStyle.includes(item))
  ) {
    boost += 0.05;
  }
  return boost;
}

function matchesFilters(store, context) {
  const specializations = (store.customVendorProfile?.specializations || []).map(normalizeText);
  const requestedCategory = normalizeText(context.category);
  const requestedStyle = normalizeText(context.style);
  const deliveryDays = Number(context.deliveryDays);
  const budgetMin = Number(context.budgetMin);
  const budgetMax = Number(context.budgetMax);
  const productionDays = Number(store.customVendorProfile?.productionTimeDays || 0);
  const minPrice = Number(store.customVendorProfile?.priceRangeMin || 0);
  const maxPrice = Number(store.customVendorProfile?.priceRangeMax || minPrice || 0);

  if (
    requestedCategory &&
    specializations.length > 0 &&
    !specializations.some((item) => item.includes(requestedCategory) || requestedCategory.includes(item))
  ) {
    return false;
  }
  if (
    requestedStyle &&
    specializations.length > 0 &&
    !specializations.some((item) => item.includes(requestedStyle) || requestedStyle.includes(item))
  ) {
    return false;
  }
  if (Number.isFinite(deliveryDays) && deliveryDays > 0 && productionDays > deliveryDays) {
    return false;
  }
  if (
    Number.isFinite(budgetMin) &&
    Number.isFinite(budgetMax) &&
    budgetMax > 0 &&
    (minPrice > budgetMax || maxPrice < budgetMin)
  ) {
    return false;
  }
  return true;
}

function buildHighlights(store, context, scores) {
  const highlights = [];
  const metrics = store.customVendorProfile?.metrics || {};

  if (store.isFeatured) {
    highlights.push('Featured designer');
  }
  if (scores.ratingScore >= 0.92) {
    highlights.push('Top rated');
  }
  if (scores.proximityScore >= 0.8) {
    highlights.push('Near you');
  }
  if (scores.deliverySpeedScore >= 0.85) {
    highlights.push('Fast delivery');
  }
  if (scores.priceMatchScore >= 0.82) {
    highlights.push('Budget match');
  }
  if (computeCategoryBoost(store, context) >= 0.1) {
    highlights.push('Best category match');
  }
  if (Number(metrics.totalCustomOrders || 0) < 20) {
    highlights.push('New designer');
  }
  if (
    Number(store.rating || 0) >= 4.7 &&
    Number(metrics.orderSuccessRate || 0) >= 0.95
  ) {
    highlights.push('Top performer');
  }

  return [...new Set(highlights)].slice(0, 3);
}

function computeVisibility(store) {
  const metrics = store.customVendorProfile?.metrics || {};
  if (
    Number(store.rating || 0) >= 4.7 &&
    Number(metrics.orderSuccessRate || 0) >= 0.95
  ) {
    return 'top_performer';
  }
  if (Number(metrics.totalCustomOrders || 0) < 20) {
    return 'new_designer';
  }
  if (store.isFeatured) {
    return 'featured';
  }
  return 'normal';
}

function rankCustomVendors(stores, context = {}) {
  return stores
    .filter((store) => matchesFilters(store, context))
    .map((store) => {
      const ratingScore = clamp(Number(store.rating || 0) / 5);
      const proximityScore = computeProximityScore(store, context);
      const successRateScore = computeSuccessRateScore(store);
      const deliverySpeedScore = computeDeliverySpeedScore(store, context);
      const priceMatchScore = computePriceMatchScore(store, context);
      const metrics = store.customVendorProfile?.metrics || {};

      let score =
        0.3 * ratingScore +
        0.2 * proximityScore +
        0.2 * successRateScore +
        0.15 * deliverySpeedScore +
        0.15 * priceMatchScore;

      score += computeCategoryBoost(store, context);

      if (Number(metrics.totalCustomOrders || 0) < 20) {
        score += 0.04;
      }
      if (
        Number(store.rating || 0) >= 4.7 &&
        Number(metrics.orderSuccessRate || 0) >= 0.95
      ) {
        score += 0.05;
      }
      if (store.isFeatured) {
        score += 0.03;
      }

      return {
        ...store,
        vendorScore: Number(Math.min(score, 1.2).toFixed(4)),
        vendorVisibility: computeVisibility(store),
        vendorHighlights: buildHighlights(store, context, {
          ratingScore,
          proximityScore,
          successRateScore,
          deliverySpeedScore,
          priceMatchScore,
        }),
      };
    })
    .sort((left, right) => {
      if (right.vendorScore !== left.vendorScore) {
        return right.vendorScore - left.vendorScore;
      }
      if (right.rating !== left.rating) {
        return right.rating - left.rating;
      }
      return left.name.localeCompare(right.name);
    })
    .map((store, index) => ({
      ...store,
      vendorRank: index + 1,
    }));
}

module.exports = {
  rankCustomVendors,
};
