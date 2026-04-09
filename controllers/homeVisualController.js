const HomeVisualConfig = require('../models/HomeVisualConfig');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
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
    .map((item, index) => ({
      id: item.id?.toString().trim() || `category-${index + 1}`,
      tab: ['All', 'Men', 'Women', 'Kids'].includes(item.tab) ? item.tab : 'All',
      label: item.label?.toString().trim() || 'Category',
      imageUrl: item.imageUrl?.toString().trim() || '',
      icon: item.icon?.toString().trim() || 'category',
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.imageUrl);
}

function normalizePromoBlocks(items = []) {
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: item.id?.toString().trim() || `promo-${index + 1}`,
      slot: Number.isFinite(Number(item.slot)) ? Number(item.slot) : index + 1,
      eyebrow: item.eyebrow?.toString().trim() || '',
      title: item.title?.toString().trim() || 'Promo banner',
      subtitle: item.subtitle?.toString().trim() || '',
      ctaText: item.ctaText?.toString().trim() || 'Explore',
      imageUrl: item.imageUrl?.toString().trim() || '',
      redirectType: ['product', 'store', 'category', 'custom'].includes(item.redirectType)
        ? item.redirectType
        : 'category',
      redirectId: item.redirectId?.toString().trim() || '',
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.imageUrl);
}

function normalizeFeaturedStoreBlocks(items = []) {
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: item.id?.toString().trim() || `featured-store-${index + 1}`,
      storeId: item.storeId?.toString().trim() || '',
      imageUrl: item.imageUrl?.toString().trim() || '',
      label: item.label?.toString().trim() || '',
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
      isActive: item.isActive !== false,
    }))
    .filter((item) => item.storeId);
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
