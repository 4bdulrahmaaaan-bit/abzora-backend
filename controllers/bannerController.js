const Banner = require('../models/Banner');
const { isAllowedAdminEmail } = require('./authController');

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
  return {
    id: item._id?.toString?.() || '',
    image: item.imageUrl || '',
    imageUrl: item.imageUrl || '',
    title: item.title || '',
    subtitle: item.subtitle || '',
    ctaText: item.ctaText || 'Shop Now',
    redirectType: item.redirectType || 'store',
    redirectId: item.redirectId || '',
    order: Number(item.order || 0),
    isActive: item.isActive !== false,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

function normalizeBannerPayload(body = {}) {
  const rawOrder = Number(body.order ?? 0);
  return {
    imageUrl: body.imageUrl?.toString().trim() || body.image?.toString().trim() || '',
    title: body.title?.toString().trim() || '',
    subtitle: body.subtitle?.toString().trim() || '',
    ctaText: body.ctaText?.toString().trim() || 'Shop Now',
    redirectType: ['product', 'store', 'category'].includes(body.redirectType)
      ? body.redirectType
      : 'store',
    redirectId: body.redirectId?.toString().trim() || '',
    order: Number.isFinite(rawOrder) ? rawOrder : 0,
    isActive: body.isActive !== false,
  };
}

async function listBanners(req, res, next) {
  try {
    const isPrivilegedRequest =
      (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);

    const query = isPrivilegedRequest ? {} : { isActive: true };
    const items = await Banner.find(query).sort({ order: 1, updatedAt: -1 }).lean();
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
