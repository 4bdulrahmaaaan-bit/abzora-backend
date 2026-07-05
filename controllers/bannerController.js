const Banner = require('../models/Banner');
const { isAllowedAdminEmail } = require('./authController');

const SUPPORTED_TARGET_TYPES = new Set([
  'category',
  'collection',
  'brand',
  'campaign',
  'sale_campaign',
  'product_listing',
  'product',
  'single_product',
  'store',
  'custom_deep_link',
]);

function normalizeTargetType(value) {
  const normalized = value?.toString().trim().toLowerCase().replace(/[\s-]+/g, '_') || 'category';
  if (normalized === 'salecampaign') {
    return 'sale_campaign';
  }
  if (normalized === 'custom') {
    return 'custom_deep_link';
  }
  if (normalized === 'singleproduct') {
    return 'single_product';
  }
  if (SUPPORTED_TARGET_TYPES.has(normalized)) {
    return normalized;
  }
  return 'category';
}

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function serializeBanner(item) {
  const targetType =
    item.targetType?.toString?.().trim() ||
    item.redirectType?.toString?.().trim() ||
    'category';
  const targetId =
    item.targetId?.toString?.().trim() ||
    item.redirectId?.toString?.().trim() ||
    '';
  const sortOrder = Number(
    item.sortOrder ?? item.order ?? 0,
  );
  const active = item.active !== false && item.isActive !== false;
  return {
    id: item._id?.toString?.() || '',
    image: item.imageUrl || '',
    imageUrl: item.imageUrl || '',
    title: item.title || '',
    subtitle: item.subtitle || '',
    ctaText: item.ctaText || 'Shop Now',
    targetType,
    targetId,
    deeplink: item.deeplink || '',
    sortOrder,
    active,
    redirectType: targetType,
    redirectId: targetId,
    order: sortOrder,
    isActive: active,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

function normalizeBannerPayload(body = {}) {
  const rawOrder = Number(body.order ?? 0);
  const targetType = normalizeTargetType(body.targetType ?? body.redirectType);
  const targetId =
    body.targetId?.toString().trim() || body.redirectId?.toString().trim() || '';
  const deeplink = body.deeplink?.toString().trim() || '';
  const active = body.active !== false && body.isActive !== false;
  return {
    imageUrl: body.imageUrl?.toString().trim() || body.image?.toString().trim() || '',
    title: body.title?.toString().trim() || '',
    subtitle: body.subtitle?.toString().trim() || '',
    ctaText: body.ctaText?.toString().trim() || 'Shop Now',
    targetType,
    targetId,
    deeplink,
    sortOrder: Number.isFinite(rawOrder) ? rawOrder : 0,
    active,
    redirectType: targetType,
    redirectId: targetId,
    order: Number.isFinite(rawOrder) ? rawOrder : 0,
    isActive: active,
  };
}

async function listBanners(req, res, next) {
  try {
    const isPrivilegedRequest =
      (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);

    const query = isPrivilegedRequest ? {} : { isActive: true };
    const items = await Banner.find(query)
      .sort({ sortOrder: 1, order: 1, updatedAt: -1 })
      .lean();
    return res.status(200).json({
      success: true,
      data: items.map(serializeBanner),
    });
  } catch (error) {
    return next(error);
  }
}

async function createBanner(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const payload = normalizeBannerPayload(req.body);
    if (!payload.imageUrl) {
      return res.status(400).json({ success: false, message: 'Banner image is required.' });
    }

    const created = await Banner.create(payload);
    return res.status(201).json({
      success: true,
      data: serializeBanner(created),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateBanner(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const payload = normalizeBannerPayload(req.body);
    if (!payload.imageUrl) {
      return res.status(400).json({ success: false, message: 'Banner image is required.' });
    }

    const updated = await Banner.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Banner not found.' });
    }

    return res.status(200).json({
      success: true,
      data: serializeBanner(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteBanner(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const removed = await Banner.findByIdAndDelete(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Banner not found.' });
    }

    return res.status(200).json({
      success: true,
      data: { id: req.params.id },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
};
