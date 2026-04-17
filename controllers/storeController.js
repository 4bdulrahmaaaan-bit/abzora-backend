const mongoose = require('mongoose');

const Store = require('../models/Store');
const { rankCustomVendors } = require('../services/customVendorRankingService');

function sanitizeVendorEditableCustomProfile(profile = {}) {
  return {
    experienceYears: Number(profile.experienceYears || 0),
    specializations: Array.isArray(profile.specializations)
      ? profile.specializations.map((item) => item?.toString().trim()).filter(Boolean)
      : [],
    portfolioImages: Array.isArray(profile.portfolioImages)
      ? profile.portfolioImages.map((item) => item?.toString().trim()).filter(Boolean)
      : [],
    priceRangeMin: Number(profile.priceRangeMin || 0),
    priceRangeMax: Number(profile.priceRangeMax || 0),
    productionTimeDays: Number(profile.productionTimeDays || 0),
    qualityApprovalRequired: Boolean(profile.qualityApprovalRequired),
    supportsAlterations: profile.supportsAlterations !== false,
    alterationPolicy: profile.alterationPolicy?.toString().trim() || '',
  };
}

function normalizeSameDayConfig(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled == null ? Boolean(fallback.enabled) : source.enabled === true,
    cutoffHour: source.cutoffHour == null
      ? Number(fallback.cutoffHour ?? 16)
      : Math.min(23, Math.max(0, Number(source.cutoffHour || 16))),
    prepTimeMins: source.prepTimeMins == null
      ? Number(fallback.prepTimeMins ?? 60)
      : Math.min(600, Math.max(10, Number(source.prepTimeMins || 60))),
    supportsTrialHome: source.supportsTrialHome == null
      ? fallback.supportsTrialHome !== false
      : source.supportsTrialHome !== false,
  };
}

function serializeStore(store, extras = {}, options = {}) {
  if (!store) {
    return null;
  }

  const includeInternalFields = options.includeInternalFields === true;
  const source = typeof store.toObject === 'function' ? store.toObject() : store;
  const payload = {
    id: source._id?.toString() || source.id || '',
    vendorId: source.vendorId?._id?.toString?.() || source.vendorId?.toString?.() || '',
    name: source.name || '',
    description: source.description || '',
    vendorType: source.vendorType || 'standard_vendor',
    rating: Number(source.rating || 0),
    reviewCount: Number(source.reviewCount || 0),
    isFeatured: Boolean(source.isFeatured),
    approvalStatus: source.approvalStatus || 'approved',
    logoUrl: source.logoUrl || '',
    bannerImageUrl: source.bannerImageUrl || '',
    address: source.address || '',
    city: source.city || '',
    latitude: source.latitude == null ? null : Number(source.latitude),
    longitude: source.longitude == null ? null : Number(source.longitude),
    tagline: source.tagline || '',
    category: source.category || '',
    isActive: Boolean(source.isActive),
    sameDay: normalizeSameDayConfig(source.sameDay || {}, source.sameDay || {}),
    operationalSpeedScore: Number(source.operationalSpeedScore || 50),
    vendorScore: Number(extras.vendorScore ?? source.vendorScore ?? 0),
    vendorRank: Number(extras.vendorRank ?? source.vendorRank ?? 0),
    vendorVisibility: extras.vendorVisibility || source.vendorVisibility || 'normal',
    vendorHighlights: extras.vendorHighlights || source.vendorHighlights || [],
    customVendorProfile: {
      experienceYears: Number(source.customVendorProfile?.experienceYears || 0),
      specializations: source.customVendorProfile?.specializations || [],
      portfolioImages: source.customVendorProfile?.portfolioImages || [],
      priceRangeMin: Number(source.customVendorProfile?.priceRangeMin || 0),
      priceRangeMax: Number(source.customVendorProfile?.priceRangeMax || 0),
      productionTimeDays: Number(source.customVendorProfile?.productionTimeDays || 0),
      qualityApprovalRequired: Boolean(
        source.customVendorProfile?.qualityApprovalRequired,
      ),
      supportsAlterations: source.customVendorProfile?.supportsAlterations !== false,
      alterationPolicy: source.customVendorProfile?.alterationPolicy || '',
    },
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };

  if (includeInternalFields) {
    payload.ownerId = source.ownerId || '';
    payload.commissionRate = Number(source.commissionRate || 0.12);
    payload.walletBalance = Number(source.walletBalance || 0);
    payload.customVendorProfile.qualityTier = source.customVendorProfile?.qualityTier || 'normal';
    payload.customVendorProfile.penaltyPoints = Number(source.customVendorProfile?.penaltyPoints || 0);
    payload.customVendorProfile.activeCustomOrderLimit = Number(
      source.customVendorProfile?.activeCustomOrderLimit || 0,
    );
    payload.customVendorProfile.metrics = {
      orderSuccessRate: Number(
        source.customVendorProfile?.metrics?.orderSuccessRate || 0,
      ),
      delayRate: Number(source.customVendorProfile?.metrics?.delayRate || 0),
      returnRate: Number(source.customVendorProfile?.metrics?.returnRate || 0),
      totalCustomOrders: Number(
        source.customVendorProfile?.metrics?.totalCustomOrders || 0,
      ),
      completedCustomOrders: Number(
        source.customVendorProfile?.metrics?.completedCustomOrders || 0,
      ),
    };
  }

  return payload;
}

async function createStore(req, res, next) {
  try {
    const {
      name,
      description,
      rating,
      logoUrl,
      vendorType,
      address,
      city,
      latitude,
      longitude,
      tagline,
      bannerImageUrl,
      category,
      customVendorProfile,
      sameDay,
      operationalSpeedScore,
    } = req.body || {};
    const ownerId = req.user?.uid?.toString().trim();
    const normalizedName = name?.toString().trim() || '';
    const normalizedDescription = description?.toString().trim() || '';

    if (!ownerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!normalizedName) {
      return res.status(400).json({ success: false, message: 'Store name is required.' });
    }

    const store = await Store.create({
      name: normalizedName,
      rating: Number(rating || 0),
      description: normalizedDescription,
      logoUrl: logoUrl?.toString().trim() || '',
      vendorType:
        vendorType === 'custom_vendor' ? 'custom_vendor' : 'standard_vendor',
      address: address?.toString().trim() || '',
      city: city?.toString().trim() || '',
      latitude: latitude == null ? null : Number(latitude),
      longitude: longitude == null ? null : Number(longitude),
      geoLocation:
        latitude != null && longitude != null
          ? {
              type: 'Point',
              coordinates: [Number(longitude), Number(latitude)],
            }
          : undefined,
      tagline: tagline?.toString().trim() || '',
      bannerImageUrl: bannerImageUrl?.toString().trim() || '',
      category: category?.toString().trim() || '',
      customVendorProfile:
        vendorType === 'custom_vendor' && customVendorProfile
          ? sanitizeVendorEditableCustomProfile(customVendorProfile)
          : undefined,
      sameDay: normalizeSameDayConfig(sameDay || {}),
      operationalSpeedScore: Math.min(100, Math.max(0, Number(operationalSpeedScore || 50))),
      ownerId,
    });

    return res.status(201).json({
      success: true,
      data: serializeStore(store, {}, { includeInternalFields: true }),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listStores(req, res, next) {
  try {
    const stores = await Store.find({ isActive: true })
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: stores.map(serializeStore) });
  } catch (error) {
    return next(error);
  }
}

async function listRankedCustomStores(req, res, next) {
  try {
    const context = {
      category: req.query.category,
      style: req.query.style,
      budgetMin: req.query.budgetMin,
      budgetMax: req.query.budgetMax,
      deliveryDays: req.query.deliveryDays,
      latitude: req.query.latitude,
      longitude: req.query.longitude,
    };

    const stores = await Store.find({
      vendorType: 'custom_vendor',
      isActive: true,
      approvalStatus: { $ne: 'rejected' },
    }).sort({ isFeatured: -1, rating: -1, createdAt: -1 });

    const ranked = rankCustomVendors(
      stores.map((store) =>
        typeof store.toObject === 'function' ? store.toObject() : store,
      ),
      context,
    );

    return res.status(200).json({
      success: true,
      data: ranked.map((store) => serializeStore(store, store)),
    });
  } catch (error) {
    return next(error);
  }
}

async function getStore(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }

    const store = await Store.findById(id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }

    return res.status(200).json({
      success: true,
      data: serializeStore(store, {}, { includeInternalFields: true }),
    });
  } catch (error) {
    return next(error);
  }
}

async function getOwnStore(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const store = await Store.findOne({
      $or: [
        { ownerId: req.user.uid },
        ...(req.dbUser?._id ? [{ vendorId: req.dbUser._id }] : []),
        ...(req.dbUser?.storeId && mongoose.Types.ObjectId.isValid(req.dbUser.storeId)
          ? [{ _id: req.dbUser.storeId }]
          : []),
      ],
    }).sort({ createdAt: -1 });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }

    return res.status(200).json({ success: true, data: serializeStore(store) });
  } catch (error) {
    return next(error);
  }
}

async function updateStore(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }

    const store = await Store.findById(id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only update your own store.' });
    }

    const {
      name,
      description,
      logoUrl,
      isActive,
      vendorType,
      address,
      city,
      latitude,
      longitude,
      tagline,
      bannerImageUrl,
      category,
      customVendorProfile,
      sameDay,
      operationalSpeedScore,
    } = req.body || {};
    const normalizedName = name?.toString().trim() || store.name;
    if (!normalizedName) {
      return res.status(400).json({ success: false, message: 'Store name is required.' });
    }

    store.name = normalizedName;
    store.description = description?.toString().trim() ?? store.description;
    store.logoUrl = logoUrl?.toString().trim() ?? store.logoUrl;
    if (typeof vendorType === 'string' && ['standard_vendor', 'custom_vendor'].includes(vendorType.trim())) {
      store.vendorType = vendorType.trim();
    }
    store.address = address?.toString().trim() ?? store.address;
    store.city = city?.toString().trim() ?? store.city;
    if (latitude !== undefined) {
      store.latitude = latitude == null ? null : Number(latitude);
    }
    if (longitude !== undefined) {
      store.longitude = longitude == null ? null : Number(longitude);
    }
    if (store.latitude != null && store.longitude != null) {
      store.geoLocation = {
        type: 'Point',
        coordinates: [Number(store.longitude), Number(store.latitude)],
      };
    }
    store.tagline = tagline?.toString().trim() ?? store.tagline;
    store.bannerImageUrl = bannerImageUrl?.toString().trim() ?? store.bannerImageUrl;
    store.category = category?.toString().trim() ?? store.category;
    if (customVendorProfile && typeof customVendorProfile === 'object') {
      store.customVendorProfile = {
        ...(store.customVendorProfile?.toObject?.() ?? store.customVendorProfile ?? {}),
        ...sanitizeVendorEditableCustomProfile(customVendorProfile),
      };
    }
    if (sameDay && typeof sameDay === 'object') {
      store.sameDay = normalizeSameDayConfig(sameDay, store.sameDay || {});
    }
    if (operationalSpeedScore !== undefined) {
      store.operationalSpeedScore = Math.min(
        100,
        Math.max(0, Number(operationalSpeedScore || 0)),
      );
    }
    if (typeof isActive === 'boolean') {
      store.isActive = isActive;
    }
    await store.save();

    return res.status(200).json({
      success: true,
      data: serializeStore(store, {}, { includeInternalFields: true }),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  createStore,
  listStores,
  listRankedCustomStores,
  getStore,
  getOwnStore,
  updateStore,
};
