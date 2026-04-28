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

function validateUnityMetadata({ unityAssetBundleUrl, rigProfile, materialProfile }) {
  const normalizedBundleUrl = normalizeOptionalUrl(unityAssetBundleUrl);
  const normalizedRigProfile = rigProfile?.toString().trim() || '';
  const normalizedMaterialProfile = materialProfile?.toString().trim() || '';

  if (unityAssetBundleUrl != null && !normalizedBundleUrl) {
    return { error: 'unityAssetBundleUrl must be a valid http/https URL.', data: null };
  }
  if (!ALLOWED_RIG_PROFILES.has(normalizedRigProfile)) {
    return { error: 'Unsupported rigProfile value.', data: null };
  }
  if (!ALLOWED_MATERIAL_PROFILES.has(normalizedMaterialProfile)) {
    return { error: 'Unsupported materialProfile value.', data: null };
  }

  return {
    error: '',
    data: {
      unityAssetBundleUrl: normalizedBundleUrl,
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
    description: source.description || '',
    stock: Number(source.stock || 0),
    category: source.category || '',
    subcategory: source.subcategory || '',
    images: Array.isArray(source.images) ? source.images : [],
    model3d: source.model3d || '',
    unityAssetBundleUrl: source.unityAssetBundleUrl || '',
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
      unityAssetBundleUrl,
      rigProfile,
      materialProfile,
      storeId,
      stock,
      category,
      subcategory,
      description,
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
    const unityValidation = validateUnityMetadata({
      unityAssetBundleUrl,
      rigProfile,
      materialProfile,
    });
    if (unityValidation.error) {
      return res.status(400).json({ success: false, message: unityValidation.error });
    }

    const product = await Product.create({
      name: normalizedName,
      brand: normalizedBrand,
      price: normalizedPrice,
      images: Array.isArray(images)
          ? images.map((item) => item?.toString().trim()).filter(Boolean)
          : [],
      model3d: normalizedModel3d,
      unityAssetBundleUrl: unityValidation.data.unityAssetBundleUrl,
      rigProfile: unityValidation.data.rigProfile,
      materialProfile: unityValidation.data.materialProfile,
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

    const products = await Product.find({ storeId: store._id }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      data: products.map((product) => serializeProduct(product, { store })),
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
      unityAssetBundleUrl,
      rigProfile,
      materialProfile,
      stock,
      category,
      subcategory,
      description,
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
    const unityValidation = validateUnityMetadata({
      unityAssetBundleUrl: unityAssetBundleUrl == null ? product.unityAssetBundleUrl : unityAssetBundleUrl,
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
    if (unityValidation.error) {
      return res.status(400).json({ success: false, message: unityValidation.error });
    }

    product.name = normalizedName;
    product.brand = normalizedBrand;
    product.price = normalizedPrice;
    product.stock = normalizedStock;
    product.category = normalizedCategory;
    product.subcategory = subcategory == null ? product.subcategory : subcategory.toString().trim();
    product.description = description?.toString().trim() ?? product.description;
    if (model3d != null) {
      product.model3d = model3d.toString().trim();
    }
    if (unityAssetBundleUrl != null) {
      product.unityAssetBundleUrl = unityValidation.data.unityAssetBundleUrl;
    }
    if (rigProfile != null) {
      product.rigProfile = unityValidation.data.rigProfile;
    }
    if (materialProfile != null) {
      product.materialProfile = unityValidation.data.materialProfile;
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
  deleteProduct,
  generateProductArAsset,
};
