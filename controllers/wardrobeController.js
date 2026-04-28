const mongoose = require('mongoose');

const WardrobeOutfit = require('../models/WardrobeOutfit');
const {
  calculateOutfitScore,
  inferStyleConsistency,
  inferTrendPopularity,
  loadProductsByIds,
  recommendFromWardrobe,
  scheduleReminderWindows,
} = require('../services/wardrobeEngineService');

function getUserId(req) {
  return req.user?.uid || req.user?.firebaseUid || req.user?.id || '';
}

function sanitizeTitle(value) {
  const title = value?.toString().trim() || '';
  return title ? title.slice(0, 80) : 'Saved Look';
}

function sanitizeThumbnail(value) {
  const url = value?.toString().trim() || '';
  if (!url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
  } catch (_) {
    return '';
  }
}

function parseProductIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => value?.toString().trim() || '')
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

function serializeWardrobeOutfit(outfit, productsById = new Map()) {
  const ids = Array.isArray(outfit.productIds)
    ? outfit.productIds.map((id) => id?.toString?.() || id?.toString?.() || '').filter(Boolean)
    : [];
  const products = ids
    .map((id) => productsById.get(id))
    .filter(Boolean)
    .map((product) => ({
      id: product._id?.toString() || '',
      name: product.name || '',
      image: Array.isArray(product.images) ? product.images[0] || '' : '',
      price: Number(product.price || 0),
      category: product.category || '',
      subcategory: product.subcategory || '',
    }));

  return {
    id: outfit._id?.toString() || '',
    title: outfit.title || 'Saved Look',
    thumbnailUrl: outfit.thumbnailUrl || '',
    productIds: ids,
    products,
    styleScore: Number(outfit.styleScore || 0),
    scoreBreakdown: outfit.scoreBreakdown || { fit: 0, style: 0, trend: 0 },
    scoreExplanation: outfit.scoreExplanation || '',
    fitConfidence: Number(outfit.fitConfidence || 0),
    fitWarnings: Array.isArray(outfit.fitWarnings) ? outfit.fitWarnings : [],
    tags: Array.isArray(outfit.tags) ? outfit.tags : [],
    reminderSchedule: outfit.reminderSchedule || null,
    lastRetriedAt: outfit.lastRetriedAt || null,
    createdAt: outfit.createdAt || null,
    updatedAt: outfit.updatedAt || null,
  };
}

async function saveOutfit(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const productIds = parseProductIds(req.body?.productIds);
    if (!productIds.length) {
      return res.status(400).json({ success: false, message: 'productIds is required.' });
    }

    const products = await loadProductsByIds(productIds);
    if (!products.length) {
      return res.status(404).json({ success: false, message: 'Products not found.' });
    }

    const styleConsistency = inferStyleConsistency(products);
    const trendPopularity = inferTrendPopularity(products);
    const fitConfidence = Math.max(0, Math.min(1, Number(req.body?.fitConfidence ?? 0.78)));
    const score = calculateOutfitScore({
      fitConfidence,
      styleConsistency,
      trendPopularity,
    });

    const outfit = await WardrobeOutfit.create({
      userId,
      title: sanitizeTitle(req.body?.title),
      productIds,
      thumbnailUrl: sanitizeThumbnail(req.body?.thumbnailUrl) || (products[0]?.images?.[0] || ''),
      fitConfidence,
      styleScore: score.total,
      scoreBreakdown: score.breakdown,
      scoreExplanation: score.explanation,
      fitWarnings: Array.isArray(req.body?.fitWarnings)
        ? req.body.fitWarnings.map((item) => item?.toString?.().trim?.() || '').filter(Boolean).slice(0, 6)
        : [],
      tags: Array.isArray(req.body?.tags)
        ? req.body.tags.map((item) => item?.toString?.().trim?.().toLowerCase?.() || '').filter(Boolean).slice(0, 10)
        : [],
      reminderSchedule: scheduleReminderWindows(),
      status: 'active',
    });

    const productsById = new Map(products.map((product) => [product._id.toString(), product]));
    return res.status(201).json({
      success: true,
      data: serializeWardrobeOutfit(outfit, productsById),
    });
  } catch (error) {
    return next(error);
  }
}

async function getWardrobe(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 24)));
    const outfits = await WardrobeOutfit.find({ userId, status: 'active' })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    const productIds = outfits.flatMap((outfit) => outfit.productIds || []);
    const products = await loadProductsByIds(productIds);
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));

    return res.status(200).json({
      success: true,
      data: outfits.map((outfit) => serializeWardrobeOutfit(outfit, productsById)),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateWardrobeOutfit(req, res, next) {
  try {
    const userId = getUserId(req);
    const outfitId = req.params.id?.toString().trim() || '';
    if (!mongoose.Types.ObjectId.isValid(outfitId)) {
      return res.status(400).json({ success: false, message: 'Invalid outfit id.' });
    }

    const existing = await WardrobeOutfit.findOne({ _id: outfitId, userId, status: 'active' });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Outfit not found.' });
    }

    const nextProductIds = parseProductIds(req.body?.productIds);
    if (nextProductIds.length) {
      existing.productIds = nextProductIds;
    }
    if (req.body?.title != null) {
      existing.title = sanitizeTitle(req.body.title);
    }
    if (req.body?.thumbnailUrl != null) {
      const thumbnail = sanitizeThumbnail(req.body.thumbnailUrl);
      if (thumbnail) {
        existing.thumbnailUrl = thumbnail;
      }
    }
    if (req.body?.markRetried === true) {
      existing.lastRetriedAt = new Date();
    }

    const products = await loadProductsByIds(existing.productIds || []);
    const styleConsistency = inferStyleConsistency(products);
    const trendPopularity = inferTrendPopularity(products);
    const score = calculateOutfitScore({
      fitConfidence: existing.fitConfidence || 0.75,
      styleConsistency,
      trendPopularity,
    });
    existing.styleScore = score.total;
    existing.scoreBreakdown = score.breakdown;
    existing.scoreExplanation = score.explanation;
    existing.reminderSchedule = scheduleReminderWindows();

    await existing.save();

    const productsById = new Map(products.map((product) => [product._id.toString(), product]));
    return res.status(200).json({
      success: true,
      data: serializeWardrobeOutfit(existing, productsById),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteWardrobeOutfit(req, res, next) {
  try {
    const userId = getUserId(req);
    const outfitId = req.params.id?.toString().trim() || '';
    if (!mongoose.Types.ObjectId.isValid(outfitId)) {
      return res.status(400).json({ success: false, message: 'Invalid outfit id.' });
    }

    const result = await WardrobeOutfit.updateOne(
      { _id: outfitId, userId, status: 'active' },
      { $set: { status: 'archived' } }
    );
    if (!result.modifiedCount) {
      return res.status(404).json({ success: false, message: 'Outfit not found.' });
    }

    return res.status(200).json({ success: true, data: { deleted: true } });
  } catch (error) {
    return next(error);
  }
}

async function recommendFromUserWardrobe(req, res, next) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const limit = Math.max(1, Math.min(24, Number(req.query.limit || 12)));
    const outfits = await WardrobeOutfit.find({ userId, status: 'active' })
      .sort({ updatedAt: -1 })
      .limit(24)
      .lean();

    const outfitProducts = [];
    for (const outfit of outfits) {
      const products = await loadProductsByIds(outfit.productIds || []);
      outfitProducts.push({ products });
    }

    const recommendations = await recommendFromWardrobe({
      outfits: outfitProducts,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: recommendations.map((item) => ({
        score: item.score,
        product: {
          id: item.product._id?.toString() || '',
          name: item.product.name || '',
          image: Array.isArray(item.product.images) ? item.product.images[0] || '' : '',
          price: Number(item.product.price || 0),
          category: item.product.category || '',
          subcategory: item.product.subcategory || '',
          fitRisk: Number(item.product.fitRisk || 0),
          sameDayEligible: Boolean(item.product.sameDayEligible),
        },
      })),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  deleteWardrobeOutfit,
  getWardrobe,
  recommendFromUserWardrobe,
  saveOutfit,
  updateWardrobeOutfit,
};
