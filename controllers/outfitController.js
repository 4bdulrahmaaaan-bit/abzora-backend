const mongoose = require('mongoose');

const Product = require('../models/Product');
const {
  generateOutfitRecommendations,
  trackOutfitInteraction,
  recommendProductsForBodyType,
} = require('../services/outfitEngine');

function normalizeLimit(value, fallback = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(12, Math.floor(parsed)));
}

async function getOutfits(req, res, next) {
  try {
    const userId =
      req.query.userId?.toString().trim() ||
      req.user?.uid ||
      req.user?.firebaseUid ||
      '';
    const productId = req.query.productId?.toString().trim() || '';
    const occasion = req.query.occasion?.toString().trim() || '';
    const budget = req.query.budget?.toString().trim() || '';
    const style = req.query.style?.toString().trim() || '';
    const limit = normalizeLimit(req.query.limit, productId ? 3 : 6);

    if (productId && !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid productId.',
      });
    }

    const outfits = await generateOutfitRecommendations({
      userId,
      productId,
      occasion,
      budget,
      style,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: outfits,
    });
  } catch (error) {
    return next(error);
  }
}

async function trackOutfit(req, res, next) {
  try {
    const action = (req.body?.action || '').toString().trim().toLowerCase();
    const outfitId = req.body?.outfitId?.toString().trim() || '';
    const productId = req.body?.productId?.toString().trim() || '';
    const itemIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.map((item) => item?.toString?.().trim?.() || '').filter(Boolean)
      : [];

    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'action is required.',
      });
    }

    await trackOutfitInteraction({
      userId: req.user?.uid || req.user?.firebaseUid || req.user?.id || '',
      action,
      outfitId,
      productId,
      itemIds,
      filters:
        req.body?.filters && typeof req.body.filters === 'object'
          ? req.body.filters
          : {},
      metadata:
        req.body?.metadata && typeof req.body.metadata === 'object'
          ? req.body.metadata
          : {},
    });

    return res.status(200).json({
      success: true,
      data: { tracked: true },
    });
  } catch (error) {
    return next(error);
  }
}

async function getCompleteLook(req, res, next) {
  try {
    const productId = req.params.productId?.toString().trim() || '';
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid productId.',
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    const outfits = await generateOutfitRecommendations({
      userId:
        req.query.userId?.toString().trim() ||
        req.user?.uid ||
        req.user?.firebaseUid ||
        '',
      productId,
      occasion: req.query.occasion?.toString().trim() || '',
      budget: req.query.budget?.toString().trim() || '',
      style: req.query.style?.toString().trim() || '',
      limit: normalizeLimit(req.query.limit, 3),
    });

    return res.status(200).json({
      success: true,
      data: outfits,
    });
  } catch (error) {
    return next(error);
  }
}

async function getBodyTypeRecommendations(req, res, next) {
  try {
    const userId =
      req.query.userId?.toString().trim() ||
      req.user?.uid ||
      req.user?.firebaseUid ||
      '';
    const limit = normalizeLimit(req.query.limit, 10);
    const data = await recommendProductsForBodyType({
      userId,
      limit,
    });
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getOutfits,
  trackOutfit,
  getCompleteLook,
  getBodyTypeRecommendations,
};
