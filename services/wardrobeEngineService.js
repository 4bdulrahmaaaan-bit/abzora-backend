const mongoose = require('mongoose');

const Product = require('../models/Product');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedText(value) {
  return value?.toString().trim().toLowerCase() || '';
}

function scheduleReminderWindows(baseDate = new Date()) {
  const now = new Date(baseDate);
  return {
    firstReminderAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    secondReminderAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    thirdReminderAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
}

function buildScoreExplanation({ fit, style, trend }) {
  const fitText = fit >= 85 ? 'great fit confidence' : fit >= 70 ? 'good fit confidence' : 'fit could be improved';
  const styleText = style >= 80 ? 'strong style consistency' : style >= 60 ? 'decent style match' : 'mixed styling';
  const trendText = trend >= 80 ? 'high trend relevance' : trend >= 60 ? 'moderate trend relevance' : 'low trend relevance';
  return `${fitText}, ${styleText}, ${trendText}.`;
}

function calculateOutfitScore({
  fitConfidence = 0,
  styleConsistency = 0,
  trendPopularity = 0,
}) {
  const fit = clamp(Math.round(clamp(Number(fitConfidence) * 100, 0, 100)), 0, 100);
  const style = clamp(Math.round(Number(styleConsistency)), 0, 100);
  const trend = clamp(Math.round(Number(trendPopularity)), 0, 100);
  const total = clamp(Math.round((fit * 0.45) + (style * 0.35) + (trend * 0.2)), 0, 100);
  return {
    total,
    breakdown: { fit, style, trend },
    explanation: buildScoreExplanation({ fit, style, trend }),
  };
}

function inferStyleConsistency(products) {
  if (!Array.isArray(products) || !products.length) {
    return 55;
  }

  const categories = new Set();
  const fabrics = new Set();
  const colors = new Set();
  for (const product of products) {
    categories.add(normalizedText(product.category));
    fabrics.add(normalizedText(product.fabric));
    colors.add(normalizedText(product.attributes?.color || product.attributes?.colour));
  }

  let score = 78;
  if (categories.size > 3) score -= 12;
  if (fabrics.size > 3) score -= 8;
  if (colors.size > 3) score -= 10;
  if (categories.has('shirt') && categories.has('pants')) score += 6;
  if (categories.has('dress')) score += 4;
  return clamp(score, 45, 96);
}

function inferTrendPopularity(products) {
  if (!Array.isArray(products) || !products.length) {
    return 52;
  }
  const weighted = products.reduce((sum, product) => {
    const rating = clamp(Number(product.rating || 0), 0, 5);
    const purchases = clamp(Number(product.purchaseCount || 0), 0, 10000);
    const demand = clamp(Number(product.demandScore || 0), 0, 100);
    return sum + (rating * 12) + Math.min(28, purchases / 50) + (demand * 0.35);
  }, 0);
  return clamp(Math.round(weighted / products.length), 35, 98);
}

async function loadProductsByIds(productIds = []) {
  const ids = productIds
    .map((value) => value?.toString().trim() || '')
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  if (!ids.length) {
    return [];
  }
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));
  return ids.map((id) => byId.get(id.toString())).filter(Boolean);
}

function buildWardrobeSignals(outfits = []) {
  const categories = new Map();
  const colors = new Map();
  const fabrics = new Map();

  for (const outfit of outfits) {
    for (const item of outfit.products || []) {
      const category = normalizedText(item.category);
      const color = normalizedText(item.attributes?.color || item.attributes?.colour);
      const fabric = normalizedText(item.fabric);
      if (category) categories.set(category, (categories.get(category) || 0) + 1);
      if (color) colors.set(color, (colors.get(color) || 0) + 1);
      if (fabric) fabrics.set(fabric, (fabrics.get(fabric) || 0) + 1);
    }
  }

  return { categories, colors, fabrics };
}

async function recommendFromWardrobe({ outfits = [], limit = 12 }) {
  const signals = buildWardrobeSignals(outfits);
  const topCategories = [...signals.categories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map((entry) => entry[0]);

  const topColors = [...signals.colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map((entry) => entry[0]);

  const query = { isActive: true };
  if (topCategories.length) {
    query.category = { $in: topCategories };
  }

  const candidates = await Product.find(query)
    .sort({ demandScore: -1, rating: -1, purchaseCount: -1 })
    .limit(80)
    .lean();

  const scored = candidates.map((product) => {
    const categoryScore = topCategories.includes(normalizedText(product.category)) ? 28 : 10;
    const color = normalizedText(product.attributes?.color || product.attributes?.colour);
    const colorScore = color && topColors.includes(color) ? 16 : 8;
    const trendScore = inferTrendPopularity([product]) * 0.5;
    const score = clamp(Math.round(categoryScore + colorScore + trendScore), 0, 100);
    return { product, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, clamp(Number(limit) || 12, 1, 24));
}

module.exports = {
  calculateOutfitScore,
  inferStyleConsistency,
  inferTrendPopularity,
  loadProductsByIds,
  recommendFromWardrobe,
  scheduleReminderWindows,
};
