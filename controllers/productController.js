const mongoose = require('mongoose');

const { sanitizeAttributes } = require('../config/productAttributeConfig');
const Product = require('../models/Product');
const Store = require('../models/Store');
const { generateArAsset } = require('../services/arAssetService');
const { isAllowedAdminEmail } = require('./authController');
const cache = require('../services/redisCacheService');

const ALLOWED_RIG_PROFILES = new Set([
  '',
  'male_shirt_v1',
  'male_blazer_v1',
  'female_dress_v1',
  'female_top_v1',
  'unisex_torso_v1',
]);

const ALLOWED_MATERIAL_PROFILES = new Set([
  '',
  'cotton_matte',
  'linen_soft',
  'silk_sheen',
  'wool_blend',
  'structured_formal',
]);

function normalizeOptionalUrl(value) {
  const normalized = value?.toString().trim() || '';
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return normalized;
  } catch (_) {
    return '';
  }
}

function normalizeColorHex(value, fallback = '#C6A769') {
  const normalized = value?.toString().trim() || '';
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  return fallback;
}

function parseBooleanFlag(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no'].includes(normalized)) {
    return false;
  }
  return null;
}

function parseCsvValues(value) {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => parseCsvValues(item))
      .filter((item, index, list) => list.indexOf(item) === index);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function parseNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedMapValue(map, key) {
  if (!map || typeof map !== 'object') {
    return '';
  }
  const candidate = map[key];
  return candidate == null ? '' : String(candidate).trim();
}

function deriveGender(source = {}) {
  const direct =
    normalizedMapValue(source.attributes, 'gender') ||
    normalizedMapValue(source.attributes, 'targetGender') ||
    source.gender?.toString().trim() ||
    '';
  if (direct) {
    return direct.toLowerCase();
  }
  const haystack = `${source.category || ''} ${source.subcategory || ''} ${source.name || ''}`
    .toLowerCase();
  if (haystack.includes('women') || haystack.includes('woman') || haystack.includes('ladies')) {
    return 'women';
  }
  if (haystack.includes('men') || haystack.includes('man') || haystack.includes('gent')) {
    return 'men';
  }
  return 'unisex';
}

function calculateDiscountPercentage(price, originalPrice) {
  const selling = Number(price);
  const original = Number(originalPrice);
  if (!Number.isFinite(selling) || !Number.isFinite(original) || original <= 0 || original <= selling) {
    return 0;
  }
  return Math.round(((original - selling) / original) * 100);
}

function isDiscountWindowActive(startDate, endDate, now = new Date()) {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (start && Number.isNaN(start.getTime())) return false;
  if (end && Number.isNaN(end.getTime())) return false;
  if (start && now < start) return false;
  if (end && now > end) return false;
  return true;
}

function deriveColors(source = {}) {
  const candidates = [
    source.colors,
    source.color,
    source.attributes?.colors,
    source.attributes?.color,
    source.atelier?.colorOptions,
  ];
  const values = candidates
    .flatMap((candidate) => {
      if (Array.isArray(candidate)) {
        return candidate;
      }
      if (candidate == null) {
        return [];
      }
      return String(candidate).split(',');
    })
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  return values.filter((item, index) => values.indexOf(item) === index);
}

function deriveFitConfidence(source = {}) {
  const explicit = parseNumberOrNull(source.fitConfidence ?? source.attributes?.fitConfidence);
  if (explicit != null) {
    return clampNumber(explicit, 0, 100);
  }
  const fitRisk = clampNumber(Number(source.fitRisk || 0.35), 0, 1);
  return Math.round((1 - fitRisk) * 100);
}

function deriveFitConfidenceLabel(confidence) {
  if (confidence >= 82) {
    return 'high';
  }
  if (confidence >= 62) {
    return 'medium';
  }
  return 'low';
}

function deriveReturnRisk(source = {}) {
  const fitRisk = clampNumber(Number(source.fitRisk || 0.35), 0, 1);
  return fitRisk >= 0.5 ? 'high' : 'low';
}

function deriveTryAtHomeAvailable(source = {}, store = null) {
  const productEnabled = source.trialHome?.trialEnabled === true;
  const storeSupports = store?.sameDay?.supportsTrialHome !== false;
  return productEnabled && storeSupports;
}

function deriveCustomizable(source = {}) {
  return Boolean(
    source.isCustomTailoring ||
      source.customizable === true ||
      source.atelier?.customizable === true ||
      source.atelier?.atelierEnabled === true
  );
}

function deriveSameDayAvailable(source = {}, store = null, options = {}) {
  const eligible = source.sameDayEligible !== false;
  const enabled = store?.sameDay?.enabled === true;
  const cityFilter = String(options.city || '').trim().toLowerCase();
  const cityMatches =
    !cityFilter || String(store?.city || '').trim().toLowerCase() === cityFilter;
  const cutoffHour = Number(store?.sameDay?.cutoffHour ?? 16);
  const beforeCutoff = options.ignoreCutoff === true || Number(options.currentHour ?? 0) <= cutoffHour;
  return eligible && enabled && cityMatches && beforeCutoff;
}

function deriveDeliveryTime(source = {}, store = null, options = {}) {
  if (deriveSameDayAvailable(source, store, options)) {
    return 'today';
  }
  if (source.sameDayEligible !== false || Number(store?.sameDay?.prepTimeMins ?? 0) <= 120) {
    return 'tomorrow';
  }
  return '2-3 days';
}

function buildProductListOptions(req, currentHour) {
  return {
    sameDayOnly:
      parseBooleanFlag(req.query.sameDayAvailable ?? req.query.sameDay) === true,
    tryAtHomeOnly: parseBooleanFlag(req.query.tryAtHomeAvailable) === true,
    customizableOnly:
      parseBooleanFlag(req.query.customizable ?? req.query.atelier) === true,
    city: req.query.city?.toString().trim() || '',
    currentHour,
    ignoreCutoff: req.query.ignoreCutoff === 'true',
  };
}

function toObjectIdOrNull(value) {
  const normalized = value?.toString().trim() || '';
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    return null;
  }
  return new mongoose.Types.ObjectId(normalized);
}

function normalizeStringMap(input, fallback = {}) {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input
      : fallback;
  const entries = Object.entries(source || {})
    .map(([key, value]) => [key.toString().trim(), value?.toString().trim() || ''])
    .filter(([key, value]) => key && value);
  return Object.fromEntries(entries);
}

function normalizeNumberMap(input, fallback = {}) {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input
      : fallback;
  const entries = Object.entries(source || {})
    .map(([key, value]) => [key.toString().trim(), Number(value)])
    .filter(([key, value]) => key && Number.isFinite(value));
  return Object.fromEntries(entries);
}

function normalizeGarmentConfig(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const templateIdRaw = source.templateId ?? base.templateId;
  const fitPresetRaw = (source.fitPreset ?? base.fitPreset ?? 'regular')
    .toString()
    .trim()
    .toLowerCase();
  const fitPreset = ['slim', 'regular', 'relaxed', 'oversized', 'athletic'].includes(
    fitPresetRaw
  )
    ? fitPresetRaw
    : 'regular';
  const lodPreferenceRaw = (source.lodPreference ?? base.lodPreference ?? 'auto')
    .toString()
    .trim()
    .toLowerCase();
  const lodPreference = ['auto', 'low', 'medium', 'high'].includes(lodPreferenceRaw)
    ? lodPreferenceRaw
    : 'auto';

  return {
    templateId: toObjectIdOrNull(templateIdRaw),
    fabricTextureUrl: normalizeOptionalUrl(
      source.fabricTextureUrl ?? base.fabricTextureUrl
    ),
    fitPreset,
    colorHex: normalizeColorHex(source.colorHex ?? base.colorHex),
    designOptions: normalizeStringMap(source.designOptions, base.designOptions || {}),
    blendShapeOverrides: normalizeNumberMap(
      source.blendShapeOverrides,
      base.blendShapeOverrides || {}
    ),
    lodPreference,
  };
}

function validateAssetMetadata({ assetBundleUrl, rigProfile, materialProfile }) {
  const rawBundleUrl = assetBundleUrl == null ? '' : assetBundleUrl.toString().trim();
  const normalizedBundleUrl = normalizeOptionalUrl(rawBundleUrl);
  const normalizedRigProfile = rigProfile?.toString().trim() || '';
  const normalizedMaterialProfile = materialProfile?.toString().trim() || '';

  // Asset bundle URL is optional. If malformed, silently clear it instead of
  // blocking product create/update so GLB-only try-on workflows keep working.
  if (!ALLOWED_RIG_PROFILES.has(normalizedRigProfile)) {
    return { error: 'Unsupported rigProfile value.', data: null };
  }
  if (!ALLOWED_MATERIAL_PROFILES.has(normalizedMaterialProfile)) {
    return { error: 'Unsupported materialProfile value.', data: null };
  }

  return {
    error: '',
    data: {
      assetBundleUrl: normalizedBundleUrl,
      rigProfile: normalizedRigProfile,
      materialProfile: normalizedMaterialProfile,
    },
  };
}

function productListCacheKey(query = {}, options = {}) {
  const normalized = JSON.stringify({
    query,
    options,
  });
  return `products:list:${normalized}`;
}

function singleProductCacheKey(id) {
  return `products:item:${id}`;
}

async function invalidateProductCaches(productId = '') {
  await cache.delPattern('products:list:*');
  if (productId) {
    await cache.delPattern(singleProductCacheKey(productId));
  }
}

function serializeStoreSummary(store) {
  if (!store) {
    return null;
  }

  return {
    id: store._id?.toString() || store.id || '',
    name: store.name || '',
    rating: Number(store.rating || 0),
    logoUrl: store.logoUrl || '',
    city: store.city || '',
    operationalSpeedScore: Number(store.operationalSpeedScore || 0),
    sameDay: {
      enabled: store.sameDay?.enabled === true,
      cutoffHour: Number(store.sameDay?.cutoffHour ?? 16),
      prepTimeMins: Number(store.sameDay?.prepTimeMins ?? 60),
      supportsTrialHome: store.sameDay?.supportsTrialHome !== false,
    },
  };
}

function serializeProduct(product, options = {}) {
  if (!product) {
    return null;
  }

  const source = typeof product.toObject === 'function' ? product.toObject() : product;
  const populatedStore =
    options.store ||
    (source.storeId && typeof source.storeId === 'object' ? source.storeId : null);

  const serialized = {
    id: source._id?.toString() || source.id || '',
    name: source.name || '',
    brand: source.brand || populatedStore?.name || '',
    price: Number(source.price || 0),
    basePrice: source.basePrice == null ? null : Number(source.basePrice),
    dynamicPrice: source.dynamicPrice == null ? null : Number(source.dynamicPrice),
    originalPrice: source.originalPrice == null ? null : Number(source.originalPrice),
    discountPercentage: Number(source.discountPercentage || 0),
    isDiscountActive: Boolean(source.isDiscountActive),
    discountStartDate: source.discountStartDate || null,
    discountEndDate: source.discountEndDate || null,
    description: source.description || '',
    stock: Number(source.stock || 0),
    category: source.category || '',
    subcategory: source.subcategory || '',
    images: Array.isArray(source.images) ? source.images : [],
    model3d: source.model3d || '',
    assetBundleUrl: source.assetBundleUrl || '',
    rigProfile: source.rigProfile || '',
    materialProfile: source.materialProfile || '',
    sizes: Array.isArray(source.sizes) && source.sizes.length > 0 ? source.sizes : ['S', 'M', 'L'],
    demandScore: Number(source.demandScore || 0),
    viewCount: Number(source.viewCount || 0),
    cartCount: Number(source.cartCount || 0),
    purchaseCount: Number(source.purchaseCount || 0),
    fitRisk: Number(source.fitRisk || 0),
    sameDayEligible: source.sameDayEligible !== false,
    rating: Number(source.rating || 0),
    reviewCount: Number(source.reviewCount || 0),
    outfitType: source.outfitType || '',
    fabric: source.fabric || '',
    attributes: source.attributes ? Object.fromEntries(Object.entries(source.attributes)) : {},
    arAsset: source.arAsset || {},
    storeId: populatedStore ? populatedStore._id?.toString() || populatedStore.id || '' : source.storeId?.toString() || '',
    store: populatedStore ? serializeStoreSummary(populatedStore) : null,
    isActive: Boolean(source.isActive),
    trialHome: {
      trialEnabled: Boolean(source.trialHome?.trialEnabled),
      allowedLocations: Array.isArray(source.trialHome?.allowedLocations)
        ? source.trialHome.allowedLocations
        : [],
      trialLimitPerDay: Number(source.trialHome?.trialLimitPerDay || 20),
      trialFee: Number(source.trialHome?.trialFee || 99),
      approvalMode: source.trialHome?.approvalMode || 'auto',
    },
    atelier: normalizeAtelierProductConfig(source.atelier || {}, source.atelier || {}),
    garmentConfig: {
      templateId:
        source.garmentConfig?.templateId?.toString?.() ||
        source.garmentConfig?.templateId ||
        '',
      fabricTextureUrl: source.garmentConfig?.fabricTextureUrl || '',
      fitPreset: source.garmentConfig?.fitPreset || 'regular',
      colorHex: source.garmentConfig?.colorHex || '#C6A769',
      designOptions: source.garmentConfig?.designOptions
        ? Object.fromEntries(Object.entries(source.garmentConfig.designOptions))
        : {},
      blendShapeOverrides: source.garmentConfig?.blendShapeOverrides
        ? Object.fromEntries(Object.entries(source.garmentConfig.blendShapeOverrides))
        : {},
      lodPreference: source.garmentConfig?.lodPreference || 'auto',
    },
    isCustomTailoring: Boolean(source.atelier?.atelierEnabled || source.atelier?.customizable),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
  const fitConfidence = deriveFitConfidence(source);
  serialized.gender = deriveGender(source);
  serialized.colors = deriveColors(source);
  serialized.sameDayAvailable = deriveSameDayAvailable(source, populatedStore, options);
  serialized.tryAtHomeAvailable = deriveTryAtHomeAvailable(source, populatedStore);
  serialized.customizable = deriveCustomizable(serialized);
  serialized.deliveryTime = deriveDeliveryTime(source, populatedStore, options);
  serialized.fitConfidence = fitConfidence;
  serialized.fitConfidenceLabel = deriveFitConfidenceLabel(fitConfidence);
  serialized.returnRisk = deriveReturnRisk(source);
  serialized.popularity =
    (Number(source.demandScore || 0) * 100) +
    (Number(source.purchaseCount || 0) * 4) +
    (Number(source.viewCount || 0) * 0.4);
  const computedDiscount = calculateDiscountPercentage(serialized.price, serialized.originalPrice);
  const windowActive = isDiscountWindowActive(serialized.discountStartDate, serialized.discountEndDate);
  serialized.discountPercentage = computedDiscount;
  serialized.isDiscountActive = computedDiscount > 0 && windowActive;
  if (!serialized.isDiscountActive) {
    serialized.originalPrice = null;
  }
  return serialized;
}

function applyProductFilters(products, filters = {}) {
  const categories = parseCsvValues(filters.category);
  const genders = parseCsvValues(filters.gender).map((item) => item.toLowerCase());
  const sizes = parseCsvValues(filters.size).map((item) => item.toUpperCase());
  const colors = parseCsvValues(filters.color).map((item) => item.toLowerCase());
  const brands = parseCsvValues(filters.brand).map((item) => item.toLowerCase());
  const deliveryTimes = parseCsvValues(filters.deliveryTime).map((item) => item.toLowerCase());
  const fitConfidenceLabels = parseCsvValues(filters.fitConfidence).map((item) => item.toLowerCase());
  const returnRisks = parseCsvValues(filters.returnRisk).map((item) => item.toLowerCase());
  const minPrice = parseNumberOrNull(filters.minPrice);
  const maxPrice = parseNumberOrNull(filters.maxPrice);
  const minRating = parseNumberOrNull(filters.rating);
  const sameDayAvailable = parseBooleanFlag(filters.sameDayAvailable ?? filters.sameDay);
  const tryAtHomeAvailable = parseBooleanFlag(filters.tryAtHomeAvailable);
  const customizable = parseBooleanFlag(filters.customizable ?? filters.atelier);

  return products.filter((item) => {
    if (categories.length > 0 && !categories.includes(item.category)) {
      return false;
    }
    if (genders.length > 0 && !genders.includes(String(item.gender || '').toLowerCase())) {
      return false;
    }
    if (sizes.length > 0) {
      const productSizes = (Array.isArray(item.sizes) ? item.sizes : []).map((size) =>
        String(size).toUpperCase()
      );
      if (!sizes.some((size) => productSizes.includes(size))) {
        return false;
      }
    }
    if (colors.length > 0) {
      const productColors = (Array.isArray(item.colors) ? item.colors : []).map((color) =>
        String(color).toLowerCase()
      );
      if (!colors.some((color) => productColors.includes(color))) {
        return false;
      }
    }
    if (brands.length > 0 && !brands.includes(String(item.brand || '').toLowerCase())) {
      return false;
    }
    if (minPrice != null && Number(item.price || 0) < minPrice) {
      return false;
    }
    if (maxPrice != null && Number(item.price || 0) > maxPrice) {
      return false;
    }
    if (sameDayAvailable != null && item.sameDayAvailable !== sameDayAvailable) {
      return false;
    }
    if (tryAtHomeAvailable != null && item.tryAtHomeAvailable !== tryAtHomeAvailable) {
      return false;
    }
    if (customizable != null && item.customizable !== customizable) {
      return false;
    }
    if (deliveryTimes.length > 0 && !deliveryTimes.includes(String(item.deliveryTime || '').toLowerCase())) {
      return false;
    }
    if (
      fitConfidenceLabels.length > 0 &&
      !fitConfidenceLabels.includes(String(item.fitConfidenceLabel || '').toLowerCase())
    ) {
      return false;
    }
    if (returnRisks.length > 0 && !returnRisks.includes(String(item.returnRisk || '').toLowerCase())) {
      return false;
    }
    if (minRating != null && Number(item.rating || 0) < minRating) {
      return false;
    }
    return true;
  });
}

function sortProducts(products, sort = 'relevance') {
  const normalized = String(sort || 'relevance').trim().toLowerCase();
  const sorted = [...products];
  sorted.sort((left, right) => {
    switch (normalized) {
      case 'price_low_to_high':
        return Number(left.price || 0) - Number(right.price || 0);
      case 'price_high_to_low':
        return Number(right.price || 0) - Number(left.price || 0);
      case 'newest':
        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      case 'popularity':
        return Number(right.popularity || 0) - Number(left.popularity || 0);
      case 'same_day_priority':
        if (left.sameDayAvailable !== right.sameDayAvailable) {
          return left.sameDayAvailable ? -1 : 1;
        }
        if (left.tryAtHomeAvailable !== right.tryAtHomeAvailable) {
          return left.tryAtHomeAvailable ? -1 : 1;
        }
        return Number(right.popularity || 0) - Number(left.popularity || 0);
      case 'relevance':
      default:
        if (left.sameDayAvailable !== right.sameDayAvailable) {
          return left.sameDayAvailable ? -1 : 1;
        }
        if (Number(left.fitConfidence || 0) !== Number(right.fitConfidence || 0)) {
          return Number(right.fitConfidence || 0) - Number(left.fitConfidence || 0);
        }
        if (Number(left.rating || 0) !== Number(right.rating || 0)) {
          return Number(right.rating || 0) - Number(left.rating || 0);
        }
        if (Number(left.popularity || 0) !== Number(right.popularity || 0)) {
          return Number(right.popularity || 0) - Number(left.popularity || 0);
        }
        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    }
  });
  return sorted;
}

function normalizeTrialHomeConfig(raw = {}, fallback = {}) {
  const allowedLocations = Array.isArray(raw.allowedLocations)
    ? raw.allowedLocations
        .map((item) => item?.toString().trim())
        .filter(Boolean)
    : (Array.isArray(fallback.allowedLocations) ? fallback.allowedLocations : []);
  const trialLimitPerDayRaw =
    raw.trialLimitPerDay == null ? fallback.trialLimitPerDay : raw.trialLimitPerDay;
  const trialLimitPerDay = Number(trialLimitPerDayRaw || 20);
  const trialFeeRaw = raw.trialFee == null ? fallback.trialFee : raw.trialFee;
  const trialFee = Number(trialFeeRaw || 99);
  const approvalModeRaw =
    raw.approvalMode == null ? fallback.approvalMode : raw.approvalMode;
  const approvalMode = approvalModeRaw?.toString().trim().toLowerCase() === 'manual'
    ? 'manual'
    : 'auto';
  const trialEnabledRaw =
    raw.trialEnabled == null ? fallback.trialEnabled : raw.trialEnabled;
  const trialEnabled = trialEnabledRaw === true;

  return {
    trialEnabled,
    allowedLocations,
    trialLimitPerDay:
      Number.isFinite(trialLimitPerDay) && trialLimitPerDay > 0
        ? Math.min(Math.floor(trialLimitPerDay), 500)
        : 20,
    trialFee:
      Number.isFinite(trialFee) && trialFee >= 0
        ? Math.min(Math.round(trialFee), 5000)
        : 99,
    approvalMode,
  };
}

function normalizeStringList(raw, fallback = []) {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return [...new Set(raw.map((item) => item?.toString().trim()).filter(Boolean))].slice(0, 20);
}

function normalizeAtelierProductConfig(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    customizable:
      source.customizable == null ? Boolean(base.customizable) : source.customizable === true,
    atelierEnabled:
      source.atelierEnabled == null ? Boolean(base.atelierEnabled) : source.atelierEnabled === true,
    fabricOptions: normalizeStringList(source.fabricOptions, base.fabricOptions || []),
    colorOptions: normalizeStringList(source.colorOptions, base.colorOptions || []),
    styleVariants: normalizeStringList(source.styleVariants, base.styleVariants || []),
    addOnOptions: normalizeStringList(source.addOnOptions, base.addOnOptions || []),
    allowedMeasurementOptions: normalizeStringList(
      source.allowedMeasurementOptions,
      base.allowedMeasurementOptions || [],
    ).filter((item) => ['manual', 'trial', 'visit', 'standard'].includes(item)),
    baseTailoringCharge: Math.max(0, Number(source.baseTailoringCharge ?? base.baseTailoringCharge ?? 0)),
    homeVisitCharge: Math.max(0, Number(source.homeVisitCharge ?? base.homeVisitCharge ?? 0)),
  };
}

function shouldGenerateArAsset(body) {
  return body?.disableArAssetGeneration !== true;
}

async function createProduct(req, res, next) {
  try {
    const {
      name,
      brand,
      price,
      images,
      model3d,
      assetBundleUrl,
      rigProfile,
      materialProfile,
      storeId,
      stock,
      category,
      subcategory,
      description,
      original_price,
      discount_start_date,
      discount_end_date,
      attributes,
      arAsset,
      trialHome,
      atelier,
      garmentConfig,
    } = req.body || {};
    const normalizedName = name?.toString().trim() || '';
    const normalizedCategory = category?.toString().trim() || '';
    const normalizedDescription = description?.toString().trim() || '';
    const normalizedPrice = Number(price);
    const normalizedOriginalPrice =
      original_price == null || original_price === '' ? null : Number(original_price);
    const normalizedStock = Number(stock || 0);

    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!normalizedName || !normalizedCategory || !storeId || Number.isNaN(normalizedPrice)) {
      return res.status(400).json({
        success: false,
        message: 'name, price, category, and storeId are required.',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }
    if (normalizedPrice < 0) {
      return res.status(400).json({ success: false, message: 'Price must be zero or greater.' });
    }
    if (normalizedOriginalPrice != null && (Number.isNaN(normalizedOriginalPrice) || normalizedOriginalPrice < 0)) {
      return res.status(400).json({ success: false, message: 'Original price must be zero or greater.' });
    }
    const discountStartDate = discount_start_date ? new Date(discount_start_date) : null;
    const discountEndDate = discount_end_date ? new Date(discount_end_date) : null;
    if ((discountStartDate && Number.isNaN(discountStartDate.getTime())) || (discountEndDate && Number.isNaN(discountEndDate.getTime()))) {
      return res.status(400).json({ success: false, message: 'Invalid discount date range.' });
    }
    if (discountStartDate && discountEndDate && discountEndDate < discountStartDate) {
      return res.status(400).json({ success: false, message: 'Discount end date must be after start date.' });
    }
    const discountPercentage = calculateDiscountPercentage(normalizedPrice, normalizedOriginalPrice);
    const discountActive = discountPercentage > 0 && isDiscountWindowActive(discountStartDate, discountEndDate);
    if (normalizedStock < 0) {
      return res.status(400).json({ success: false, message: 'Stock cannot be negative.' });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user?.uid) {
      return res.status(403).json({
        success: false,
        message: 'You can only add products to your own store.',
      });
    }

    const normalizedBrand = brand?.toString().trim() || '';
    const normalizedModel3d = model3d?.toString().trim() || '';
    const assetValidation = validateAssetMetadata({
      assetBundleUrl,
      rigProfile,
      materialProfile,
    });
    if (assetValidation.error) {
      return res.status(400).json({ success: false, message: assetValidation.error });
    }

    const product = await Product.create({
      name: normalizedName,
      brand: normalizedBrand,
      price: normalizedPrice,
      originalPrice: discountPercentage > 0 ? normalizedOriginalPrice : null,
      discountPercentage,
      isDiscountActive: discountActive,
      discountStartDate: discountStartDate || null,
      discountEndDate: discountEndDate || null,
      images: Array.isArray(images)
          ? images.map((item) => item?.toString().trim()).filter(Boolean)
          : [],
      model3d: normalizedModel3d,
      assetBundleUrl: assetValidation.data.assetBundleUrl,
      rigProfile: assetValidation.data.rigProfile,
      materialProfile: assetValidation.data.materialProfile,
      storeId,
      stock: normalizedStock,
      category: normalizedCategory,
      subcategory: subcategory?.toString().trim() || '',
      description: normalizedDescription,
      attributes: sanitizeAttributes(subcategory?.toString().trim() || normalizedCategory, attributes),
      arAsset: arAsset && typeof arAsset === 'object' && !Array.isArray(arAsset) ? arAsset : {},
      trialHome: normalizeTrialHomeConfig(trialHome),
      atelier: normalizeAtelierProductConfig(atelier),
      garmentConfig: normalizeGarmentConfig(garmentConfig),
    });
    if (shouldGenerateArAsset(req.body) && Array.isArray(product.images) && product.images.length > 0) {
      product.arAsset = await generateArAsset({ product });
      await product.save();
    }
    await invalidateProductCaches(product._id?.toString() || '');

    return res.status(201).json({
      success: true,
      data: serializeProduct(product, { store }),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

function deriveDiscountStatus(item) {
  if (!item || !item.discountPercentage || item.discountPercentage <= 0) {
    return 'active';
  }
  const now = new Date();
  const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
  const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
  if (start && now < start) {
    return 'scheduled';
  }
  if (end && now > end) {
    return 'expired';
  }
  return item.isDiscountActive ? 'active' : 'expired';
}

async function listProducts(req, res, next) {
  try {
    const query = { isActive: true };
    if (req.query.storeId && mongoose.Types.ObjectId.isValid(req.query.storeId)) {
      query.storeId = req.query.storeId;
    }
    const categories = parseCsvValues(req.query.category);
    if (categories.length === 1) {
      query.category = categories[0];
    } else if (categories.length > 1) {
      query.category = { $in: categories };
    }
    const minPrice = parseNumberOrNull(req.query.minPrice);
    const maxPrice = parseNumberOrNull(req.query.maxPrice);
    if (minPrice != null || maxPrice != null) {
      query.price = {};
      if (minPrice != null) {
        query.price.$gte = minPrice;
      }
      if (maxPrice != null) {
        query.price.$lte = maxPrice;
      }
    }
    const now = new Date();
    const hour = now.getHours();
    const listOptions = buildProductListOptions(req, hour);
    const sameDayOnly = listOptions.sameDayOnly;
    const atelierOnly = listOptions.customizableOnly;
    const cityFilter = listOptions.city;
    const cutoffOverride = listOptions.ignoreCutoff === true;
    const minRating = parseNumberOrNull(req.query.rating);
    if (minRating != null) {
      query.rating = { $gte: minRating };
    }
    const sizeFilters = parseCsvValues(req.query.size).map((value) => value.toUpperCase());
    if (sizeFilters.length > 0) {
      query.sizes = { $in: sizeFilters };
    }
    if (sameDayOnly) {
      query.sameDayEligible = true;
    }
    if (atelierOnly) {
      query['atelier.atelierEnabled'] = true;
    }
    const tryAtHomeOnly = parseBooleanFlag(req.query.tryAtHomeAvailable) === true;
    if (tryAtHomeOnly) {
      query['trialHome.trialEnabled'] = true;
    }
    const cacheKey = productListCacheKey(query, {
      filters: req.query,
      city: cityFilter,
      currentHour: hour,
      ignoreCutoff: cutoffOverride,
    });
    const cached = await cache.getJson(cacheKey);
    if (Array.isArray(cached)) {
      return res.status(200).json({ success: true, data: cached });
    }

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .populate('storeId', 'name rating logoUrl city sameDay operationalSpeedScore isActive');
    let serialized = products.map((product) => serializeProduct(product, listOptions));
    serialized = applyProductFilters(serialized, req.query);
    serialized = sortProducts(serialized, req.query.sort);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(
      1,
      Math.min(100, parseInt(req.query.limit, 10) || serialized.length || 20)
    );
    const paged = req.query.page || req.query.limit
      ? serialized.slice((page - 1) * limit, (page - 1) * limit + limit)
      : serialized;
    await cache.setJson(cacheKey, paged, 120);

    return res.status(200).json({ success: true, data: paged });
  } catch (error) {
    return next(error);
  }
}

async function resolveOwnedStore(user) {
  if (!user) {
    return null;
  }

  const storeCandidates = [
    ...(user._id ? [{ vendorId: user._id }] : []),
    ...(user.firebaseUid ? [{ ownerId: user.firebaseUid }] : []),
    ...(user.uid ? [{ ownerId: user.uid }] : []),
    ...((user.storeId || '').trim().length > 0 && mongoose.Types.ObjectId.isValid(user.storeId)
      ? [{ _id: user.storeId }]
      : []),
  ];

  if (storeCandidates.length === 0) {
    return null;
  }

  return Store.findOne({ $or: storeCandidates }).sort({ createdAt: -1 });
}

async function listVendorProducts(req, res, next) {
  try {
    const store = await resolveOwnedStore(req.dbUser || req.user);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found for this vendor account.',
      });
    }

    const requestedStoreId = req.query.storeId?.toString().trim() || '';
    if (requestedStoreId && requestedStoreId !== store._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only view products from your own store.',
      });
    }

    const categoryFilter = String(req.query?.category || '').trim();
    const minPrice = parseNumberOrNull(req.query?.minPrice);
    const maxPrice = parseNumberOrNull(req.query?.maxPrice);
    const sortBy = String(req.query?.sortBy || 'newest').trim().toLowerCase();
    const query = { storeId: store._id };
    if (categoryFilter) {
      query.category = categoryFilter;
    }
    if (minPrice != null || maxPrice != null) {
      query.price = {};
      if (minPrice != null) query.price.$gte = minPrice;
      if (maxPrice != null) query.price.$lte = maxPrice;
    }

    const products = await Product.find(query).sort({
      createdAt: -1,
    });
    const tableRows = products.map((product) => {
      const serialized = serializeProduct(product, { store });
      const views = Number(serialized.viewCount || 0);
      const purchases = Number(serialized.purchaseCount || 0);
      const conversionRate = views > 0 ? Number(((purchases / views) * 100).toFixed(2)) : 0;
      return {
        ...serialized,
        conversionRate,
        pricingStatus: deriveDiscountStatus(serialized),
      };
    });

    if (sortBy === 'price_asc') {
      tableRows.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (sortBy === 'price_desc') {
      tableRows.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (sortBy === 'performance') {
      tableRows.sort((a, b) => Number(b.conversionRate || 0) - Number(a.conversionRate || 0));
    }

    return res.status(200).json({
      success: true,
      data: tableRows,
    });
  } catch (error) {
    return next(error);
  }
}

async function getProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const cacheKey = singleProductCacheKey(id);
    const cached = await cache.getJson(cacheKey);
    if (cached && typeof cached === 'object') {
      return res.status(200).json({ success: true, data: cached });
    }

    const product = await Product.findById(id).populate('storeId', 'name rating logoUrl');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    const serialized = serializeProduct(product);
    await cache.setJson(cacheKey, serialized, 180);

    return res.status(200).json({ success: true, data: serialized });
  } catch (error) {
    return next(error);
  }
}

async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const store = await Store.findById(product.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const isAdmin =
      ['admin', 'super_admin'].includes((req.user?.role || '').toLowerCase()) &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (store.ownerId !== req.user.uid && !isAdmin) {
      return res.status(403).json({ success: false, message: 'You can only update products from your own store.' });
    }

    const {
      name,
      brand,
      price,
      images,
      model3d,
      assetBundleUrl,
      rigProfile,
      materialProfile,
      stock,
      category,
      subcategory,
      description,
      original_price,
      discount_start_date,
      discount_end_date,
      attributes,
      arAsset,
      isActive,
      trialHome,
      atelier,
      garmentConfig,
    } = req.body || {};
    const normalizedName = name?.toString().trim() || product.name;
    const normalizedBrand =
      brand == null
        ? (product.brand || '')
        : (brand?.toString().trim() || '');
    const normalizedCategory = category?.toString().trim() || product.category;
    const normalizedPrice = price == null ? product.price : Number(price);
    const normalizedStock = stock == null ? product.stock : Number(stock);
    const normalizedOriginalPrice =
      original_price == null
        ? product.originalPrice
        : (original_price === '' ? null : Number(original_price));
    const assetValidation = validateAssetMetadata({
      assetBundleUrl: assetBundleUrl == null ? product.assetBundleUrl : assetBundleUrl,
      rigProfile: rigProfile == null ? product.rigProfile : rigProfile,
      materialProfile: materialProfile == null ? product.materialProfile : materialProfile,
    });

    if (!normalizedName || !normalizedCategory || Number.isNaN(normalizedPrice)) {
      return res.status(400).json({
        success: false,
        message: 'name, price, and category are required.',
      });
    }
    if (normalizedPrice < 0) {
      return res.status(400).json({ success: false, message: 'Price must be zero or greater.' });
    }
    if (normalizedStock < 0) {
      return res.status(400).json({ success: false, message: 'Stock cannot be negative.' });
    }
    if (normalizedOriginalPrice != null && (Number.isNaN(normalizedOriginalPrice) || normalizedOriginalPrice < 0)) {
      return res.status(400).json({ success: false, message: 'Original price must be zero or greater.' });
    }
    const discountStartDate = discount_start_date == null
      ? product.discountStartDate
      : (discount_start_date === '' ? null : new Date(discount_start_date));
    const discountEndDate = discount_end_date == null
      ? product.discountEndDate
      : (discount_end_date === '' ? null : new Date(discount_end_date));
    if ((discountStartDate && Number.isNaN(new Date(discountStartDate).getTime())) || (discountEndDate && Number.isNaN(new Date(discountEndDate).getTime()))) {
      return res.status(400).json({ success: false, message: 'Invalid discount date range.' });
    }
    if (discountStartDate && discountEndDate && new Date(discountEndDate) < new Date(discountStartDate)) {
      return res.status(400).json({ success: false, message: 'Discount end date must be after start date.' });
    }
    const discountPercentage = calculateDiscountPercentage(normalizedPrice, normalizedOriginalPrice);
    const discountActive = discountPercentage > 0 && isDiscountWindowActive(discountStartDate, discountEndDate);
    if (assetValidation.error) {
      return res.status(400).json({ success: false, message: assetValidation.error });
    }

    product.name = normalizedName;
    product.brand = normalizedBrand;
    product.price = normalizedPrice;
    product.originalPrice = discountPercentage > 0 ? normalizedOriginalPrice : null;
    product.discountPercentage = discountPercentage;
    product.isDiscountActive = discountActive;
    product.discountStartDate = discountStartDate || null;
    product.discountEndDate = discountEndDate || null;
    product.stock = normalizedStock;
    product.category = normalizedCategory;
    product.subcategory = subcategory == null ? product.subcategory : subcategory.toString().trim();
    product.description = description?.toString().trim() ?? product.description;
    if (model3d != null) {
      product.model3d = model3d.toString().trim();
    }
    if (assetBundleUrl != null) {
      product.assetBundleUrl = assetValidation.data.assetBundleUrl;
    }
    if (rigProfile != null) {
      product.rigProfile = assetValidation.data.rigProfile;
    }
    if (materialProfile != null) {
      product.materialProfile = assetValidation.data.materialProfile;
    }
    if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
      product.attributes = sanitizeAttributes(
        (subcategory == null ? product.subcategory : subcategory.toString().trim()) || normalizedCategory,
        attributes,
      );
    }
    if (arAsset && typeof arAsset === 'object' && !Array.isArray(arAsset)) {
      product.arAsset = arAsset;
    }
    if (Array.isArray(images)) {
      product.images = images.map((item) => item?.toString().trim()).filter(Boolean);
    }
    if (typeof isActive === 'boolean') {
      product.isActive = isActive;
    }
    if (trialHome && typeof trialHome === 'object' && !Array.isArray(trialHome)) {
      product.trialHome = normalizeTrialHomeConfig(trialHome, product.trialHome || {});
    }
    if (atelier && typeof atelier === 'object' && !Array.isArray(atelier)) {
      product.atelier = normalizeAtelierProductConfig(
        atelier,
        product.atelier?.toObject?.() ?? product.atelier ?? {},
      );
    }
    if (garmentConfig && typeof garmentConfig === 'object' && !Array.isArray(garmentConfig)) {
      product.garmentConfig = normalizeGarmentConfig(
        garmentConfig,
        product.garmentConfig?.toObject?.() ?? product.garmentConfig ?? {},
      );
    }
    if (
      !arAsset &&
      shouldGenerateArAsset(req.body) &&
      Array.isArray(product.images) &&
      product.images.length > 0
    ) {
      product.arAsset = await generateArAsset({ product });
    }
    await product.save();
    await invalidateProductCaches(product._id?.toString() || id);

    return res.status(200).json({ success: true, data: serializeProduct(product, { store }) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function updateVendorProductPrice(req, res, next) {
  try {
    const { product_id, price, original_price, discount_start_date, discount_end_date } = req.body || {};
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(product_id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(product_id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    const store = await Store.findById(product.storeId);
    if (!store || store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only update prices for your own store products.' });
    }

    const normalizedPrice = Number(price);
    const normalizedOriginalPrice =
      original_price == null || original_price === '' ? null : Number(original_price);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      return res.status(400).json({ success: false, message: 'price must be a valid number >= 0.' });
    }
    if (normalizedOriginalPrice != null && (!Number.isFinite(normalizedOriginalPrice) || normalizedOriginalPrice < 0)) {
      return res.status(400).json({ success: false, message: 'original_price must be a valid number >= 0.' });
    }

    const discountStartDate = discount_start_date ? new Date(discount_start_date) : null;
    const discountEndDate = discount_end_date ? new Date(discount_end_date) : null;
    if ((discountStartDate && Number.isNaN(discountStartDate.getTime())) || (discountEndDate && Number.isNaN(discountEndDate.getTime()))) {
      return res.status(400).json({ success: false, message: 'Invalid discount date range.' });
    }
    if (discountStartDate && discountEndDate && discountEndDate < discountStartDate) {
      return res.status(400).json({ success: false, message: 'discount_end_date must be after discount_start_date.' });
    }

    const discountPercentage = calculateDiscountPercentage(normalizedPrice, normalizedOriginalPrice);
    const discountActive = discountPercentage > 0 && isDiscountWindowActive(discountStartDate, discountEndDate);

    product.price = normalizedPrice;
    product.originalPrice = discountPercentage > 0 ? normalizedOriginalPrice : null;
    product.discountPercentage = discountPercentage;
    product.isDiscountActive = discountActive;
    product.discountStartDate = discountStartDate || null;
    product.discountEndDate = discountEndDate || null;
    await product.save();
    await invalidateProductCaches(product._id?.toString() || product_id);

    return res.status(200).json({
      success: true,
      data: {
        product_id: product._id.toString(),
        price: product.price,
        original_price: product.originalPrice,
        discount_percentage: product.discountPercentage,
        is_discount_active: product.isDiscountActive,
        discount_start_date: product.discountStartDate,
        discount_end_date: product.discountEndDate,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function bulkUpdateVendorProductPrices(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const {
      product_ids,
      mode = 'set',
      unit = 'amount',
      change_value = 0,
      set_mrp = null,
      discount_percent = null,
      remove_discount = false,
      discount_start_date = null,
      discount_end_date = null,
      preview_only = false,
    } = req.body || {};

    const ids = Array.isArray(product_ids)
      ? product_ids.map((id) => String(id || '').trim()).filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'product_ids are required.' });
    }

    const store = await resolveOwnedStore(req.dbUser || req.user);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found for this vendor account.' });
    }

    const products = await Product.find({
      _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
      storeId: store._id,
    });
    if (products.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching products found for this vendor store.' });
    }

    const delta = Number(change_value || 0);
    const normalizedMrp = set_mrp == null || set_mrp === '' ? null : Number(set_mrp);
    const normalizedDiscount =
      discount_percent == null || discount_percent === '' ? null : Number(discount_percent);
    const discountStartDate = discount_start_date ? new Date(discount_start_date) : null;
    const discountEndDate = discount_end_date ? new Date(discount_end_date) : null;

    if ((normalizedMrp != null && !Number.isFinite(normalizedMrp)) || (normalizedDiscount != null && !Number.isFinite(normalizedDiscount))) {
      return res.status(400).json({ success: false, message: 'Invalid MRP or discount value.' });
    }
    if ((discountStartDate && Number.isNaN(discountStartDate.getTime())) || (discountEndDate && Number.isNaN(discountEndDate.getTime()))) {
      return res.status(400).json({ success: false, message: 'Invalid discount date range.' });
    }

    const updates = [];
    for (const product of products) {
      let nextPrice = Number(product.price || 0);
      if (mode === 'increase') {
        nextPrice = unit === 'percent' ? nextPrice + (nextPrice * delta) / 100 : nextPrice + delta;
      } else if (mode === 'decrease') {
        nextPrice = unit === 'percent' ? nextPrice - (nextPrice * delta) / 100 : nextPrice - delta;
      } else if (mode === 'set' && Number.isFinite(delta) && delta > 0) {
        nextPrice = delta;
      }
      nextPrice = Math.max(0, Number(nextPrice.toFixed(2)));

      let nextOriginal = product.originalPrice == null ? null : Number(product.originalPrice);
      if (remove_discount) {
        nextOriginal = null;
      } else if (normalizedMrp != null) {
        nextOriginal = normalizedMrp;
      } else if (normalizedDiscount != null && normalizedDiscount > 0) {
        nextOriginal = Number((nextPrice / (1 - normalizedDiscount / 100)).toFixed(2));
      }

      const discountPercentage = calculateDiscountPercentage(nextPrice, nextOriginal);
      const discountActive =
        discountPercentage > 0 && isDiscountWindowActive(discountStartDate, discountEndDate);
      const row = {
        product_id: product._id.toString(),
        before: {
          price: Number(product.price || 0),
          original_price: product.originalPrice == null ? null : Number(product.originalPrice),
          discount_percentage: Number(product.discountPercentage || 0),
        },
        after: {
          price: nextPrice,
          original_price: discountPercentage > 0 ? nextOriginal : null,
          discount_percentage: discountPercentage,
          is_discount_active: discountActive,
          discount_start_date: discountStartDate || null,
          discount_end_date: discountEndDate || null,
        },
      };
      updates.push(row);
      if (!preview_only) {
        product.price = row.after.price;
        product.originalPrice = row.after.original_price;
        product.discountPercentage = row.after.discount_percentage;
        product.isDiscountActive = row.after.is_discount_active;
        product.discountStartDate = row.after.discount_start_date;
        product.discountEndDate = row.after.discount_end_date;
      }
    }

    if (!preview_only) {
      await Promise.all(products.map((item) => item.save()));
      await invalidateProductCaches();
    }

    return res.status(200).json({
      success: true,
      data: {
        preview_only: Boolean(preview_only),
        updated_count: updates.length,
        updates,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function generateProductArAsset(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    const store = await Store.findById(product.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const isAdmin =
      ['admin', 'super_admin'].includes((req.user?.role || '').toLowerCase()) &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (store.ownerId !== req.user.uid && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You can only generate AR assets for products in your own store.',
      });
    }

    product.arAsset = await generateArAsset({
      product,
      category: req.body?.category,
      imageUrl: req.body?.imageUrl,
      transparentImageUrl: req.body?.transparentImageUrl,
    });
    await product.save();

    return res.status(200).json({
      success: true,
      data: {
        id: product._id.toString(),
        arAsset: product.arAsset || {},
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const store = await Store.findById(product.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only delete products from your own store.' });
    }

    await product.deleteOne();
    await invalidateProductCaches(id);
    return res.status(200).json({ success: true, data: { id } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createProduct,
  listProducts,
  listVendorProducts,
  getProduct,
  updateProduct,
  updateVendorProductPrice,
  bulkUpdateVendorProductPrices,
  deleteProduct,
  generateProductArAsset,
};

