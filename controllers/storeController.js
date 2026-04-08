const mongoose = require('mongoose');

const Store = require('../models/Store');
const { rankCustomVendors } = require('../services/customVendorRankingService');

function serializeStore(store, extras = {}) {
  if (!store) {
    return null;
  }

  const source = typeof store.toObject === 'function' ? store.toObject() : store;
  return {
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
    ownerId: source.ownerId || '',
    isActive: Boolean(source.isActive),
    commissionRate: Number(source.commissionRate || 0.12),
    walletBalance: Number(source.walletBalance || 0),
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
      qualityTier: source.customVendorProfile?.qualityTier || 'normal',
      penaltyPoints: Number(source.customVendorProfile?.penaltyPoints || 0),
      activeCustomOrderLimit: Number(
        source.customVendorProfile?.activeCustomOrderLimit || 0,
      ),
      metrics: {
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
      },
    },
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
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
      tagline: tagline?.toString().trim() || '',
      bannerImageUrl: bannerImageUrl?.toString().trim() || '',
      category: category?.toString().trim() || '',
      customVendorProfile:
        vendorType === 'custom_vendor' && customVendorProfile
          ? customVendorProfile
          : undefined,
      ownerId,
    });

    return res.status(201).json({ success: true, data: serializeStore(store) });
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

    return res.status(200).json({ success: true, data: serializeStore(store) });
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
    store.tagline = tagline?.toString().trim() ?? store.tagline;
    store.bannerImageUrl = bannerImageUrl?.toString().trim() ?? store.bannerImageUrl;
    store.category = category?.toString().trim() ?? store.category;
    if (customVendorProfile && typeof customVendorProfile === 'object') {
      store.customVendorProfile = {
        ...(store.customVendorProfile?.toObject?.() ?? store.customVendorProfile ?? {}),
        ...customVendorProfile,
      };
    }
    if (typeof isActive === 'boolean') {
      store.isActive = isActive;
    }
    await store.save();

    return res.status(200).json({ success: true, data: serializeStore(store) });
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
