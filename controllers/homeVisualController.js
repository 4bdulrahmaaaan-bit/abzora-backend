const HomeVisualConfig = require('../models/HomeVisualConfig');
const { isAllowedAdminEmail } = require('./authController');

const MAX_CATEGORY_VISUALS = 20;
const MAX_PROMO_BLOCKS = 12;
const MAX_FEATURED_STORE_BLOCKS = 12;

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function normalizeOptionalUrl(value) {
  const normalized = value?.toString().trim() || '';
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch (_) {
    return '';
  }
}

function clampNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, numeric));
}

async function getOrCreateConfig() {
  let config = await HomeVisualConfig.findOne({ key: 'home-visual-config' });
  if (!config) {
    config = await HomeVisualConfig.create({ key: 'home-visual-config' });
  }
  return config;
}

function serializeCategoryVisual(item = {}) {
  return {
    id: item.id?.toString?.() || '',
    tab: item.tab?.toString?.() || 'All',
    label: item.label?.toString?.() || '',
    imageUrl: item.imageUrl?.toString?.() || '',
    icon: item.icon?.toString?.() || 'category',
    sortOrder: Number(item.sortOrder || 0),
    isActive: item.isActive !== false,
  };
}

function serializePromoBlock(item = {}) {
  return {
    id: item.id?.toString?.() || '',
    slot: Number(item.slot || 1),
    eyebrow: item.eyebrow?.toString?.() || '',
    title: item.title?.toString?.() || '',
    subtitle: item.subtitle?.toString?.() || '',
    ctaText: item.ctaText?.toString?.() || 'Explore',
    imageUrl: item.imageUrl?.toString?.() || '',
    redirectType: item.redirectType?.toString?.() || 'category',
    redirectId: item.redirectId?.toString?.() || '',
    sortOrder: Number(item.sortOrder || 0),
    isActive: item.isActive !== false,
  };
}

function serializeFeaturedStoreBlock(item = {}) {
  return {
    id: item.id?.toString?.() || '',
    storeId: item.storeId?.toString?.() || '',
    imageUrl: item.imageUrl?.toString?.() || '',
    label: item.label?.toString?.() || '',
    sortOrder: Number(item.sortOrder || 0),
    isActive: item.isActive !== false,
  };
}

function serializeConfig(config, { adminView = false } = {}) {
  const categoryVisuals = (config?.categoryVisuals || [])
    .map(serializeCategoryVisual)
    .filter((item) => adminView || item.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const promoBlocks = (config?.promoBlocks || [])
    .map(serializePromoBlock)
    .filter((item) => adminView || item.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const featuredStoreBlocks = (config?.featuredStoreBlocks || [])
    .map(serializeFeaturedStoreBlock)
    .filter((item) => adminView || item.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return {
    categoryVisuals,
    promoBlocks,
    featuredStoreBlocks,
    updatedAt: config?.updatedAt?.toISOString?.() || '',
  };
}

function normalizeCategoryVisuals(items = []) {
  return items
    .filter((item) => item && typeof item === 'object')
    .slice(0, MAX_CATEGORY_VISUALS)
    .map((item, index) => ({
      id: item.id?.toString().trim() || `category-${index + 1}`,
      tab: ['All', 'Men', 'Women', 'Kids'].includes(item.tab) ? item.tab : 'All',
      label: item.label?.toString().trim().slice(0, 40) || 'Category',
      imageUrl: normalizeOptionalUrl(item.imageUrl),
      icon: item.icon?.toString().trim() || 'category',
      sortOrder: clampNumber(item.sortOrder, index, 0, 1000),
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.imageUrl);
}

function normalizePromoBlocks(items = []) {
  return items
    .filter((item) => item && typeof item === 'object')
    .slice(0, MAX_PROMO_BLOCKS)
    .map((item, index) => ({
      id: item.id?.toString().trim() || `promo-${index + 1}`,
      slot: clampNumber(item.slot, index + 1, 1, 20),
      eyebrow: item.eyebrow?.toString().trim().slice(0, 40) || '',
      title: item.title?.toString().trim().slice(0, 80) || 'Promo banner',
      subtitle: item.subtitle?.toString().trim().slice(0, 140) || '',
      ctaText: item.ctaText?.toString().trim().slice(0, 24) || 'Explore',
      imageUrl: normalizeOptionalUrl(item.imageUrl),
      redirectType: ['product', 'store', 'category', 'custom'].includes(item.redirectType)
        ? item.redirectType
        : 'category',
      redirectId: item.redirectId?.toString().trim() || '',
      sortOrder: clampNumber(item.sortOrder, index, 0, 1000),
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.imageUrl && item.redirectId);
}

function normalizeFeaturedStoreBlocks(items = []) {
  return items
    .filter((item) => item && typeof item === 'object')
    .slice(0, MAX_FEATURED_STORE_BLOCKS)
    .map((item, index) => ({
      id: item.id?.toString().trim() || `featured-store-${index + 1}`,
      storeId: item.storeId?.toString().trim() || '',
      imageUrl: normalizeOptionalUrl(item.imageUrl),
      label: item.label?.toString().trim().slice(0, 40) || '',
      sortOrder: clampNumber(item.sortOrder, index, 0, 1000),
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.storeId && item.imageUrl);
}

async function getHomeVisualConfig(req, res, next) {
  try {
    const config = await getOrCreateConfig();
    return res.status(200).json({
      success: true,
      data: serializeConfig(config, { adminView: false }),
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminHomeVisualConfig(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const config = await getOrCreateConfig();
    return res.status(200).json({
      success: true,
      data: serializeConfig(config, { adminView: true }),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveAdminHomeVisualConfig(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const config = await getOrCreateConfig();
    config.categoryVisuals = normalizeCategoryVisuals(req.body?.categoryVisuals || []);
    config.promoBlocks = normalizePromoBlocks(req.body?.promoBlocks || []);
    config.featuredStoreBlocks = normalizeFeaturedStoreBlocks(req.body?.featuredStoreBlocks || []);
    await config.save();

    return res.status(200).json({
      success: true,
      data: serializeConfig(config, { adminView: true }),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getHomeVisualConfig,
  getAdminHomeVisualConfig,
  saveAdminHomeVisualConfig,
};
