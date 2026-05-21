const ConversationMemoryEntry = require('../models/ConversationMemoryEntry');
const SupportResponseCache = require('../models/SupportResponseCache');
const AiUsageLog = require('../models/AiUsageLog');
const AiDailyStat = require('../models/AiDailyStat');
const UserAiUsageStat = require('../models/UserAiUsageStat');
const AiEventLog = require('../models/AiEventLog');
const Product = require('../models/Product');

const memoryService = require('../services/ai/memoryService');
const cacheService = require('../services/ai/cacheService');
const costControlService = require('../services/ai/costControlService');
const { handleAIRequest } = require('../services/ai/aiGateway');
const {
  generateOutfitRecommendations,
  resolveUserIdentity,
} = require('../services/outfitEngine');
const {
  CATEGORY_SPEC_CONFIG,
  buildDynamicSpecs,
  normalizeCategory,
} = require('../services/productSpecsService');

function isAdmin(req) {
  return req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

function ensureAdmin(req, res) {
  if (!isAdmin(req)) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function normalizeFit(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  if (normalized === 'slim' || normalized === 'regular' || normalized === 'oversized') {
    return normalized;
  }
  return 'regular';
}

function clampSizeIndex(index) {
  return Math.max(0, Math.min(SIZE_ORDER.length - 1, index));
}

function confidenceLabel(score) {
  if (score >= 0.86) return 'high';
  if (score >= 0.72) return 'medium';
  return 'low';
}

function toMeasurementValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = value.toString().trim();
  if (!text) {
    return null;
  }
  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    if (Number.isFinite(left) && Number.isFinite(right)) {
      return (left + right) / 2;
    }
  }
  const singleMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!singleMatch) {
    return null;
  }
  const parsed = Number(singleMatch[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSizeChart(rawSizeChart, availableSizes = []) {
  const normalizedAvailable = Array.isArray(availableSizes)
    ? availableSizes
        .map((item) => item.toString().trim().toUpperCase())
        .filter(Boolean)
    : [];
  const chartEntries = [];

  if (rawSizeChart && typeof rawSizeChart === 'object' && !Array.isArray(rawSizeChart)) {
    // Preferred format:
    // { S: { chest: 90, waist: 80 }, M: { chest: 100, waist: 90 } }
    for (const [sizeKey, metricMap] of Object.entries(rawSizeChart)) {
      const normalizedSize = sizeKey.toString().trim().toUpperCase();
      if (!SIZE_ORDER.includes(normalizedSize) || !metricMap || typeof metricMap !== 'object') {
        continue;
      }
      const chest = toMeasurementValue(metricMap.chest ?? metricMap.chestCm);
      const waist = toMeasurementValue(metricMap.waist ?? metricMap.waistCm);
      const hip = toMeasurementValue(metricMap.hips ?? metricMap.hip ?? metricMap.hipCm);
      const shoulder = toMeasurementValue(metricMap.shoulder ?? metricMap.shoulderCm);
      const inseam = toMeasurementValue(metricMap.inseam ?? metricMap.inseamCm);
      const armLength = toMeasurementValue(metricMap.armLength ?? metricMap.armLengthCm);
      if (
        chest == null &&
        waist == null &&
        hip == null &&
        shoulder == null &&
        inseam == null &&
        armLength == null
      ) {
        continue;
      }
      chartEntries.push({
        size: normalizedSize,
        chest,
        waist,
        hip,
        shoulder,
        inseam,
        armLength,
      });
    }

    // Legacy flattened format fallback:
    // { s_chest: "90", m_waist: "80-84", ... }
    for (const [key, value] of Object.entries(rawSizeChart)) {
      const normalizedKey = key.toString().trim().toLowerCase();
      const sizeMatch = normalizedKey.match(/\b(xs|s|m|l|xl|xxl|xxxl)\b/i);
      if (!sizeMatch || value == null) {
        continue;
      }
      const size = sizeMatch[1].toUpperCase();
      const metricKey = normalizedKey.includes('waist')
        ? 'waist'
        : normalizedKey.includes('hip')
          ? 'hip'
          : normalizedKey.includes('shoulder')
            ? 'shoulder'
            : normalizedKey.includes('inseam')
              ? 'inseam'
              : normalizedKey.includes('arm')
                ? 'armLength'
                : 'chest';
      const measurement = toMeasurementValue(value);
      if (measurement == null) {
        continue;
      }
      let entry = chartEntries.find((item) => item.size === size);
      if (!entry) {
        entry = { size };
        chartEntries.push(entry);
      }
      entry[metricKey] = measurement;
    }
  }

  if (chartEntries.length === 0) {
    const baseChestBySize = {
      XS: 86,
      S: 92,
      M: 98,
      L: 104,
      XL: 112,
      XXL: 120,
      XXXL: 128,
    };
    const sizes = normalizedAvailable.length > 0 ? normalizedAvailable : SIZE_ORDER;
    for (const size of sizes) {
      const chest = baseChestBySize[size];
      if (!chest) {
        continue;
      }
      chartEntries.push({
        size,
        chest,
        waist: chest * 0.82,
        hip: chest * 0.9,
      });
    }
  }

  return chartEntries
    .filter((entry) => !normalizedAvailable.length || normalizedAvailable.includes(entry.size))
    .sort((left, right) => SIZE_ORDER.indexOf(left.size) - SIZE_ORDER.indexOf(right.size));
}

function nearestSizeFromChart({ chart, chest, waist, hip }) {
  if (!Array.isArray(chart) || chart.length === 0) {
    return null;
  }
  const targets = { chest, waist, hip };
  let best = chart[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const entry of chart) {
    let score = 0;
    if (targets.chest != null && entry.chest != null) {
      score += Math.abs(entry.chest - targets.chest) * 1.2;
    }
    if (targets.waist != null && entry.waist != null) {
      score += Math.abs(entry.waist - targets.waist) * 1.0;
    }
    if (targets.hip != null && entry.hip != null) {
      score += Math.abs(entry.hip - targets.hip) * 0.9;
    }
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best?.size || null;
}

function sizeScoreForEntry({ entry, chest, waist, hip }) {
  let score = 0;
  let matchedMetrics = 0;
  if (chest != null && entry.chest != null) {
    score += Math.abs(chest - entry.chest);
    matchedMetrics += 1;
  }
  if (waist != null && entry.waist != null) {
    score += Math.abs(waist - entry.waist);
    matchedMetrics += 1;
  }
  if (hip != null && entry.hip != null) {
    score += Math.abs(hip - entry.hip);
    matchedMetrics += 1;
  }
  return {
    score,
    matchedMetrics,
  };
}

function fallbackPopularSize(availableSizes = []) {
  const normalized = Array.isArray(availableSizes)
    ? availableSizes
        .map((item) => item?.toString?.().trim().toUpperCase())
        .filter(Boolean)
    : [];
  if (normalized.length === 0) {
    return 'M';
  }
  if (normalized.includes('M')) {
    return 'M';
  }
  return normalized[Math.floor(normalized.length / 2)] || normalized[0] || 'M';
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase();
}

function tokenizePrompt(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function uniqueStrings(values) {
  return [...new Set(values.map((item) => (item || '').toString().trim()).filter(Boolean))];
}

function detectOccasion(prompt) {
  const text = normalizeText(prompt);
  if (/(wedding|bridal|lehenga|sherwani|festive|reception)/.test(text)) {
    return 'wedding';
  }
  if (/(party|night|club|glam|date night)/.test(text)) {
    return 'party';
  }
  if (/(office|formal|work|meeting|blazer)/.test(text)) {
    return 'office';
  }
  if (/(casual|daily|everyday|weekend|college|relaxed)/.test(text)) {
    return 'casual';
  }
  return '';
}

function detectStyle(prompt) {
  const text = normalizeText(prompt);
  if (/(minimal|clean|classic|simple|essential)/.test(text)) {
    return 'minimal';
  }
  if (/(streetwear|oversized|cargo|graphic|hoodie)/.test(text)) {
    return 'streetwear';
  }
  if (/(formal|tailored|office|blazer|smart)/.test(text)) {
    return 'formal';
  }
  if (/(ethnic|kurta|lehenga|saree|festive|wedding)/.test(text)) {
    return 'ethnic';
  }
  if (/(party|glam|night|shine)/.test(text)) {
    return 'party';
  }
  return '';
}

function detectBudget(prompt) {
  const text = normalizeText(prompt);
  if (/(999|under 1000|budget)/.test(text)) {
    return 'under_999';
  }
  if (/(1999|under 2000)/.test(text)) {
    return 'under_1999';
  }
  if (/(2999|under 3000)/.test(text)) {
    return 'under_2999';
  }
  return '';
}

function detectCategory(prompt) {
  const text = normalizeText(prompt);
  const categoryMap = [
    { key: 'shirt', patterns: [/shirt/, /linen shirt/, /formal shirt/] },
    { key: 't-shirt', patterns: [/t-shirt/, /tee/, /tshirt/] },
    { key: 'kurta', patterns: [/kurta/, /kurti/] },
    { key: 'dress', patterns: [/dress/, /gown/] },
    { key: 'jeans', patterns: [/jeans/, /denim/] },
    { key: 'pants', patterns: [/pants/, /trouser/, /chino/] },
    { key: 'footwear', patterns: [/shoe/, /sneaker/, /loafer/, /sandal/, /heels?/] },
    { key: 'accessories', patterns: [/watch/, /belt/, /bag/, /accessor/] },
  ];
  for (const entry of categoryMap) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.key;
    }
  }
  return '';
}

function detectColor(prompt) {
  const colors = [
    'black',
    'white',
    'beige',
    'cream',
    'brown',
    'navy',
    'blue',
    'red',
    'green',
    'olive',
    'yellow',
    'gold',
    'pink',
    'purple',
    'maroon',
    'orange',
    'teal',
  ];
  const text = normalizeText(prompt);
  return colors.find((color) => text.includes(color)) || '';
}

function detectStylistIntent(prompt) {
  const text = normalizeText(prompt);
  if (/(size|fit|measurement|body scan)/.test(text)) {
    return 'size_help';
  }
  if (/(summer|winter|monsoon|spring|color)/.test(text)) {
    return 'color_advice';
  }
  if (/(wedding|casual|party|office|outfit|wear|look|style)/.test(text)) {
    return 'outfit';
  }
  if (/(find|show|recommend|shirt|kurta|dress|jeans|pants|shoe|product)/.test(text)) {
    return 'products';
  }
  return 'style';
}

function serializeStylistProduct(product) {
  return {
    id: product._id?.toString() || product.id || '',
    productId: product._id?.toString() || product.id || '',
    storeId: product.storeId?.toString() || '',
    name: product.name || '',
    brand: product.brand || '',
    description: product.description || '',
    price: Number(product.price || 0),
    basePrice: product.basePrice == null ? null : Number(product.basePrice),
    dynamicPrice: product.dynamicPrice == null ? null : Number(product.dynamicPrice),
    originalPrice: product.originalPrice == null ? null : Number(product.originalPrice),
    demandScore: Number(product.demandScore || 0),
    viewCount: Number(product.viewCount || 0),
    cartCount: Number(product.cartCount || 0),
    purchaseCount: Number(product.purchaseCount || 0),
    images: Array.isArray(product.images) ? product.images : [],
    image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '',
    sizes: Array.isArray(product.sizes) && product.sizes.length > 0 ? product.sizes : ['S', 'M', 'L'],
    stock: Number(product.stock || 0),
    category: product.category || '',
    isActive: Boolean(product.isActive),
    createdAt: product.createdAt || null,
    rating: Number(product.rating || 0),
    reviewCount: Number(product.reviewCount || 0),
    outfitType: product.outfitType || '',
    fabric: product.fabric || '',
    subcategory: product.subcategory || '',
    attributes: product.attributes ? Object.fromEntries(Object.entries(product.attributes)) : {},
    arAsset: product.arAsset || {},
    customizations: product.customizations || {},
    measurements: product.measurements || {},
    addons: Array.isArray(product.addons) ? product.addons : [],
  };
}

function productText(product) {
  return [
    product.name,
    product.brand,
    product.category,
    product.subcategory,
    product.description,
    product.outfitType,
    product.fabric,
    ...Object.values(product.attributes || {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function bodyFitScore(bodyType, product) {
  const normalizedBodyType = normalizeText(bodyType);
  const text = productText(product);
  if (!normalizedBodyType) {
    return 0.02;
  }
  if ((normalizedBodyType === 'slim' || normalizedBodyType === 'athletic') && /(structured|tailored|slim|fitted)/.test(text)) {
    return 0.12;
  }
  if (normalizedBodyType === 'heavy' && /(relaxed|oversized|regular|comfort)/.test(text)) {
    return 0.12;
  }
  if (normalizedBodyType === 'regular' && /(regular|classic|clean)/.test(text)) {
    return 0.08;
  }
  return 0;
}

function sizeAvailabilityScore(size, product) {
  const desiredSize = normalizeText(size).toUpperCase();
  if (!desiredSize) {
    return 0.02;
  }
  const sizes = Array.isArray(product.sizes)
    ? product.sizes.map((item) => item.toString().trim().toUpperCase())
    : [];
  return sizes.includes(desiredSize) ? 0.12 : -0.08;
}

function priceRangeScore(profile, product) {
  const min = Number(profile?.priceRange?.min || 0);
  const max = Number(profile?.priceRange?.max || 0);
  if (max <= 0) {
    return 0.03;
  }
  const price = Number(product.price || 0);
  if (price >= Math.max(0, min * 0.7) && price <= max * 1.2) {
    return 0.1;
  }
  return -0.06;
}

function keywordScore(tokens, product) {
  if (tokens.length === 0) {
    return 0.03;
  }
  const haystack = productText(product);
  return tokens.reduce((total, token) => total + (haystack.includes(token) ? 0.08 : 0), 0);
}

function buildReason(product, filters) {
  const notes = [];
  if (filters.occasion) {
    notes.push(`${filters.occasion} friendly`);
  }
  if (filters.style) {
    notes.push(`${filters.style} styling`);
  }
  if (filters.color) {
    notes.push(`${filters.color} tone`);
  }
  if (!notes.length) {
    notes.push('picked from your style profile');
  }
  return notes.join(' • ');
}

function quickRepliesForStylist(intent, filters) {
  if (intent === 'size_help') {
    return ['Scan your body', 'Suggest casual outfits', 'Show matching products'];
  }
  if (filters.occasion === 'wedding') {
    return ['Show festive colors', 'Suggest matching footwear', 'Find my size'];
  }
  if (filters.occasion === 'casual') {
    return ['Build a budget look', 'Best colors for summer', 'Find my size'];
  }
  if (intent === 'color_advice') {
    return ['Suggest casual outfits', 'Show matching products', 'What should I wear for wedding?'];
  }
  return ['Suggest casual outfits', 'What should I wear for wedding?', 'Find my size'];
}

function buildStylistMessage({
  intent,
  filters,
  size,
  bodyType,
  products,
}) {
  const intro = (() => {
    if (intent === 'size_help') {
      return size
        ? `Based on your saved fit profile, size ${size} should feel the most reliable starting point. I picked styles that stay available in your size and suit your body profile.`
        : 'I can guide your fit better if you use the size system, but I still picked styles that are easier to wear across flexible fits.';
    }
    if (filters.occasion === 'wedding') {
      return 'For a wedding-ready look, I leaned into polished statement pieces with cleaner layering and occasion-friendly textures.';
    }
    if (filters.occasion === 'casual') {
      return 'For an elevated casual look, I picked relaxed, easy-to-style pieces that still feel sharp enough for everyday dressing.';
    }
    if (intent === 'color_advice') {
      return filters.color
        ? `A ${filters.color} accent works best when it is balanced with lighter neutrals or grounded darker pieces. Here are products that fit that direction.`
        : 'For seasonal color advice, I usually balance one stronger tone with clean neutrals so the outfit feels premium instead of busy.';
    }
    return 'I pulled together a smart styling direction from your profile, current fit data, and product availability so you can shop the look directly.';
  })();

  const outro = products.length > 0
    ? 'These are real Abianzo products you can open and shop right away.'
    : 'I could not find a tight product match yet, so I am giving you style guidance first.';

  const bodyNote = bodyType ? ` Your ${bodyType} body profile was also considered while ranking the picks.` : '';
  return `${intro}${bodyNote} ${outro}`.trim();
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => item?.toString?.().trim?.() || '')
    .filter(Boolean);
}

async function rankDirectProducts({
  prompt,
  filters,
  profile,
  memory,
  limit,
  excludeIds = [],
}) {
  const query = {
    isActive: true,
    stock: { $gt: 0 },
  };

  if (filters.category) {
    query.category = { $regex: filters.category, $options: 'i' };
  } else if (filters.occasion === 'wedding') {
    query.category = { $regex: 'wedding|ethnic|festive', $options: 'i' };
  }

  const products = await Product.find(query)
    .sort({ purchaseCount: -1, rating: -1, createdAt: -1 })
    .limit(80);

  const blocked = new Set(excludeIds.map((item) => item.toString()));
  const tokens = tokenizePrompt(prompt);
  const preferredCategories = (profile?.preferredCategories || []).map((item) => normalizeText(item));
  const preferredColors = (profile?.colorPreference || []).map((item) => normalizeText(item));
  const pastPurchases = new Set(normalizeIdList(profile?.pastPurchases));
  const likedProducts = new Set(normalizeIdList(profile?.wishlist));
  const browsingHistory = new Set(normalizeIdList(profile?.browsingHistory));
  const desiredSize = (memory?.recommendedSize || memory?.size || profile?.size || '').toString().trim();
  const bodyType = memory?.bodyType || profile?.bodyType || '';

  return products
    .filter((product) => !blocked.has(product._id.toString()))
    .map((product) => {
      const text = productText(product);
      let score = 0.28;
      score += keywordScore(tokens, product);
      if (filters.style && text.includes(filters.style)) {
        score += 0.12;
      }
      if (filters.color && text.includes(filters.color)) {
        score += 0.14;
      }
      if (preferredCategories.some((category) => text.includes(category))) {
        score += 0.14;
      }
      if (preferredColors.some((color) => text.includes(color))) {
        score += 0.08;
      }
      score += bodyFitScore(bodyType, product);
      score += sizeAvailabilityScore(desiredSize, product);
      score += priceRangeScore(profile, product);
      const id = product._id?.toString?.() || '';
      if (id && pastPurchases.has(id)) {
        score += 0.18;
      }
      if (id && likedProducts.has(id)) {
        score += 0.2;
      }
      if (id && browsingHistory.has(id)) {
        score += 0.1;
      }
      score += Math.min(0.12, Number(product.demandScore || 0) * 0.18);
      score += Math.min(0.12, Number(product.purchaseCount || 0) / 40);
      return { product, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ product }) => product);
}

function buildSizeRecommendation({
  height,
  weight,
  bodyType,
  fitPreference,
  productFit,
  chest,
  waist,
  hip,
  availableSizes,
  sizeChart,
}) {
  let index = 1; // S
  if (weight >= 60 && weight <= 75) {
    index = 2; // M
  } else if (weight > 75) {
    index = 3; // L
  }

  const reasons = ['Base size from weight'];

  if (height > 180) {
    index += 1;
    reasons.push('Increased for taller height');
  } else if (height < 165) {
    index -= 1;
    reasons.push('Reduced for shorter height');
  }

  if (bodyType === 'slim') {
    index -= 1;
    reasons.push('Adjusted down for slim body type');
  } else if (bodyType === 'heavy') {
    index += 1;
    reasons.push('Adjusted up for heavy body type');
  }

  if (productFit === 'slim') {
    index += 1;
    reasons.push('Adjusted up for slim-fit product');
  } else if (productFit === 'oversized') {
    index -= 1;
    reasons.push('Adjusted down for oversized product');
  }

  if (fitPreference === 'slim') {
    index += 1;
    reasons.push('Adjusted up for slim fit preference');
  } else if (fitPreference === 'loose') {
    index -= 1;
    reasons.push('Adjusted down for loose fit preference');
  }

  index = clampSizeIndex(index);
  let recommendedSize = SIZE_ORDER[index];
  const chart = parseSizeChart(sizeChart, availableSizes);
  const chartSize = nearestSizeFromChart({ chart, chest, waist, hip });
  if (chartSize) {
    recommendedSize = chartSize;
    reasons.push('Aligned using product size chart and body measurements');
  }
  const normalizedConfidence = confidenceLabel(
    Math.max(
      0.62,
      Math.min(
        0.94,
        0.82 -
          ((height < 150 || height > 195) ? 0.06 : 0) -
          ((weight < 45 || weight > 110) ? 0.05 : 0) +
          ((chest != null && waist != null) ? 0.08 : 0) +
          (chartSize ? 0.06 : 0),
      ),
    ),
  );
  const confidenceScore = normalizedConfidence === 'high'
    ? 0.9
    : normalizedConfidence === 'medium'
      ? 0.78
      : 0.66;

  return {
    recommendedSize,
    confidence: normalizedConfidence,
    confidencePercent: Math.round(confidenceScore * 100),
    message: 'Best fit based on your body profile',
    reasoning: reasons.join(', '),
  };
}

async function runAiGateway(req, res, next) {
  try {
    const result = await handleAIRequest(req.body?.input, {
      userId: req.user.uid,
      chatId: req.body?.chatId?.toString().trim() || 'general',
      chatType: req.body?.chatType?.toString().trim() || 'general',
      task: req.body?.task?.toString().trim() || 'support',
      isPremium: req.user?.role === 'premium' || req.user?.role === 'vip',
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message || 'Unable to process AI request.',
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function recommendSize(req, res, next) {
  try {
    const height = parseNumber(req.body?.height ?? req.body?.heightCm);
    const weight = parseNumber(req.body?.weight ?? req.body?.weightKg);
    const bodyType = (req.body?.bodyType || 'regular').toString().trim().toLowerCase();
    const fitPreference = (req.body?.fitPreference || 'regular')
      .toString()
      .trim()
      .toLowerCase();
    const productFit = normalizeFit(req.body?.productFit);
    const chest = parseNumber(req.body?.chest ?? req.body?.chestCm);
    const waist = parseNumber(req.body?.waist ?? req.body?.waistCm);
    const hip = parseNumber(req.body?.hip ?? req.body?.hipCm);
    const availableSizes = Array.isArray(req.body?.availableSizes) ? req.body.availableSizes : [];
    const sizeChart = req.body?.sizeChart && typeof req.body.sizeChart === 'object'
      ? req.body.sizeChart
      : null;
    const resolved = await resolveUserIdentity(req.user?.uid || req.user?.firebaseUid || req.user?.id || '');
    const memory = resolved?.memory;
    const historySize = (memory?.recommendedSize || memory?.size || '').toString().trim().toUpperCase();

    const chart = parseSizeChart(sizeChart, availableSizes);
    const hasBodyMeasurements = chest != null || waist != null || hip != null;
    const recommendation = (() => {
      if (chart.length > 0 && hasBodyMeasurements) {
        const scored = chart
          .map((entry) => {
            const result = sizeScoreForEntry({ entry, chest, waist, hip });
            return {
              size: entry.size,
              score: result.score,
              matchedMetrics: result.matchedMetrics,
            };
          })
          .filter((item) => item.matchedMetrics > 0)
          .sort((left, right) => left.score - right.score);

        if (scored.length > 0) {
          let chosen = scored[0];
          if (scored.length > 1 && Math.abs(scored[1].score - scored[0].score) <= 2.5) {
            const firstIndex = SIZE_ORDER.indexOf(scored[0].size);
            const secondIndex = SIZE_ORDER.indexOf(scored[1].size);
            if (fitPreference === 'slim') {
              chosen = firstIndex <= secondIndex ? scored[0] : scored[1];
            } else if (fitPreference === 'loose') {
              chosen = firstIndex >= secondIndex ? scored[0] : scored[1];
            }
          }

          const minScore = scored[0].score;
          const maxScore = scored[scored.length - 1].score;
          const normalized = maxScore <= minScore
            ? 0
            : ((chosen.score - minScore) / (maxScore - minScore));
          const confidencePercent = Math.max(
            60,
            Math.min(99, Math.round(100 - (normalized * 100))),
          );
          const confidence = confidencePercent >= 86
            ? 'high'
            : confidencePercent >= 72
              ? 'medium'
              : 'low';
          return {
            recommendedSize: chosen.size,
            confidence,
            confidencePercent,
            reason: 'Best match for your chest and waist',
            reasoning: `Matched ${chosen.size} with lowest body-to-chart difference`,
            message: 'Best fit based on your body profile',
          };
        }
      }

      if (!hasBodyMeasurements && historySize) {
        return {
          recommendedSize: historySize,
          confidence: 'medium',
          confidencePercent: 78,
          reason: 'Using your previous purchase history',
          reasoning: 'No body measurements provided, reused your past size preference',
          message: 'Best fit based on your profile history',
        };
      }

      if (!hasBodyMeasurements) {
        const popular = fallbackPopularSize(availableSizes);
        return {
          recommendedSize: popular,
          confidence: 'low',
          confidencePercent: 68,
          reason: 'Using popular size fallback',
          reasoning: 'No body profile data available yet',
          message: 'Fallback recommendation',
        };
      }

      // Final fallback: heuristic engine
      const heuristic = buildSizeRecommendation({
        height: height ?? 170,
        weight: weight ?? 68,
        bodyType,
        fitPreference,
        productFit,
        chest,
        waist,
        hip,
        availableSizes,
        sizeChart,
      });
      return {
        ...heuristic,
        reason: 'Best match for your profile',
      };
    })();

    return res.status(200).json({
      success: true,
      data: recommendation,
    });
  } catch (error) {
    return next(error);
  }
}

async function stylistChat(req, res, next) {
  try {
    const prompt = req.body?.prompt?.toString().trim() || '';
    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: 'prompt is required.',
      });
    }

    const focusedProductId = req.body?.focusedProductId?.toString().trim() || '';
    const resolved = await resolveUserIdentity(req.user?.uid || req.user?.firebaseUid || req.user?.id || '');
    const memory = resolved.memory;
    const styleProfile = resolved.styleProfile;

    const filters = {
      occasion: detectOccasion(prompt),
      style: detectStyle(prompt),
      budget: detectBudget(prompt),
      category: detectCategory(prompt),
      color: detectColor(prompt),
    };
    const intent = detectStylistIntent(prompt);
    const size =
      (req.body?.size || memory?.recommendedSize || memory?.size || styleProfile?.size || '')
        .toString()
        .trim()
        .toUpperCase();
    const bodyType =
      (req.body?.bodyType || memory?.bodyType || styleProfile?.bodyType || '')
        .toString()
        .trim()
        .toLowerCase();
    const bodyContext = {
      heightCm: Number((req.body?.heightCm ?? memory?.heightCm) || 0),
      bodyType: bodyType || 'unknown',
      preference: (req.body?.preferredStyle || memory?.preferredStyle || '').toString().trim().toLowerCase() || 'casual',
      chestCm: Number((req.body?.chestCm ?? memory?.chestCm) || 0),
      waistCm: Number((req.body?.waistCm ?? memory?.waistCm) || 0),
      hipCm: Number((req.body?.hipCm ?? memory?.hipCm) || 0),
    };

    let outfits = [];
    if (intent !== 'size_help' || focusedProductId || filters.occasion || filters.style) {
      outfits = await generateOutfitRecommendations({
        userId: resolved.uid || req.user?.uid || '',
        productId: focusedProductId,
        occasion: filters.occasion,
        budget: filters.budget,
        style: filters.style,
        limit: intent === 'size_help' ? 2 : 4,
      });
    }

    const outfitProducts = [];
    const seen = new Set();
    for (const outfit of outfits) {
      for (const item of outfit.items || []) {
        const productId = (item.productId || item.id || '').toString();
        if (!productId || seen.has(productId)) {
          continue;
        }
        seen.add(productId);
        outfitProducts.push(item);
        if (outfitProducts.length >= 6) {
          break;
        }
      }
      if (outfitProducts.length >= 6) {
        break;
      }
    }

    const extraProducts = await rankDirectProducts({
      prompt,
      filters,
      profile: styleProfile,
      memory,
      limit: Math.max(0, 6 - outfitProducts.length),
      excludeIds: [...seen],
    });

    const mergedProducts = [
      ...outfitProducts.map((item) => ({
        product: item,
        reason: outfitProducts.length > 1 ? 'part of a complete outfit' : buildReason(item, filters),
      })),
      ...extraProducts.map((product) => ({
        product: serializeStylistProduct(product),
        reason: buildReason(product, filters),
      })),
    ].slice(0, 6);

    const products = mergedProducts.map((entry) => ({
      ...entry.product,
      reason: entry.reason,
      recommendedSize: size || '',
    }));
    const structuredOutfits = outfits.map((outfit) => ({
      title: outfit.title,
      items: (outfit.items || []).map((item) => item.productId || item.id).filter(Boolean),
      reason: outfit.bodyReason || outfit.reasoning || 'Enhances your body shape and personal style',
    }));

    return res.status(200).json({
      success: true,
      data: {
        message: buildStylistMessage({
          intent,
          filters,
          size,
          bodyType,
          products,
        }),
        products,
        quickReplies: quickRepliesForStylist(intent, filters),
        notes: uniqueStrings([
          'Styled for you',
          bodyType ? `Based on your body: ${bodyType}` : '',
          filters.occasion ? `Occasion: ${filters.occasion}` : '',
          filters.style ? `Style: ${filters.style}` : '',
          filters.color ? `Color cue: ${filters.color}` : '',
          size ? `Recommended size focus: ${size}` : '',
        ]),
        highlightedSize: size || '',
        intent,
        outfits: structuredOutfits,
        contextPrompt: {
          user: bodyContext,
          task: 'Recommend outfits that fit body type and style.',
        },
        personalization: {
          pastPurchases: normalizeIdList(styleProfile?.pastPurchases),
          likedProducts: normalizeIdList(styleProfile?.wishlist),
          browsingHistory: normalizeIdList(styleProfile?.browsingHistory),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function stylistRecommendations(req, res, next) {
  try {
    const resolved = await resolveUserIdentity(req.user?.uid || req.user?.firebaseUid || req.user?.id || '');
    const memory = resolved.memory;
    const styleProfile = resolved.styleProfile;
    const prompt = (req.body?.prompt || 'casual outfit recommendations').toString().trim();
    const filters = {
      occasion: detectOccasion(prompt),
      style: detectStyle(prompt),
      budget: detectBudget(prompt),
    };
    const outfits = await generateOutfitRecommendations({
      userId: resolved.uid || req.user?.uid || '',
      occasion: filters.occasion,
      budget: filters.budget,
      style: filters.style,
      limit: Math.max(1, Math.min(8, Number(req.body?.limit || 4))),
    });
    const bodyType =
      (req.body?.bodyType || memory?.bodyType || styleProfile?.bodyType || '')
        .toString()
        .trim()
        .toLowerCase();
    const payloadOutfits = outfits.map((outfit) => ({
      title: outfit.title,
      items: (outfit.items || []).map((item) => item.productId || item.id).filter(Boolean),
      reason: outfit.bodyReason || 'Balances your proportions',
    }));
    return res.status(200).json({
      success: true,
      data: {
        outfits: payloadOutfits,
        reason: 'Enhances your body shape',
        contextPrompt: {
          user: {
            heightCm: Number((req.body?.heightCm ?? memory?.heightCm) || 0),
            bodyType: bodyType || 'unknown',
            preference: (req.body?.preferredStyle || memory?.preferredStyle || '').toString().trim().toLowerCase() || 'casual',
          },
          task: 'Recommend outfits that fit body type and style.',
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getChatHistory(req, res, next) {
  try {
    const chatId = req.params.chatId?.toString() || '';
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 15)));
    const items = await ConversationMemoryEntry.find({
      userId: req.user.uid,
      chatId,
    })
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit);
    const ordered = items.reverse().map((item) => ({
      id: item.entryId,
      role: item.role,
      text: item.text,
      timestamp: item.timestamp,
    }));
    return res.status(200).json({ success: true, data: ordered });
  } catch (error) {
    return next(error);
  }
}

async function appendChatHistoryEntry(req, res, next) {
  try {
    const chatId = req.params.chatId?.toString() || '';
    const entryId = req.body?.id?.toString().trim() || '';
    const role = req.body?.role?.toString().trim() || 'user';
    const text = req.body?.text?.toString() || '';
    const timestamp = req.body?.timestamp?.toString().trim() || new Date().toISOString();
    if (!entryId || !text.trim()) {
      return res.status(400).json({ success: false, message: 'id and text are required.' });
    }

    await memoryService.appendHistoryEntry({
      userId: req.user.uid,
      chatId,
      entryId,
      role,
      text,
      timestamp,
    });

    return res.status(201).json({ success: true, data: { id: entryId } });
  } catch (error) {
    return next(error);
  }
}

async function clearUserMemory(req, res, next) {
  try {
    await memoryService.clearHistory(req.user.uid);
    return res.status(200).json({ success: true, data: { cleared: true } });
  } catch (error) {
    return next(error);
  }
}

async function getSupportCache(req, res, next) {
  try {
    const cacheInput = req.query.key?.toString().trim() || '';
    if (!cacheInput) {
      return res.status(400).json({ success: false, message: 'Cache key is required.' });
    }
    const item = await cacheService.getCachedResponse({
      userId: req.user.uid,
      input: cacheInput,
      chatType: req.query.chatType?.toString().trim() || 'general',
      intent: req.query.intent?.toString().trim() || '',
    });
    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return next(error);
  }
}

async function setSupportCache(req, res, next) {
  try {
    const input = req.body?.key?.toString().trim() || '';
    const responseText = req.body?.response?.toString() || '';
    const intent = req.body?.intent?.toString().trim() || 'ai_needed';
    const chatType = req.body?.chatType?.toString().trim() || 'general';
    const updatedAt = req.body?.updatedAt?.toString().trim() || new Date().toISOString();
    if (!input || !responseText.trim()) {
      return res.status(400).json({ success: false, message: 'key and response are required.' });
    }
    const cache = await cacheService.setCachedResponse({
      userId: req.user.uid,
      input,
      response: responseText,
      chatType,
      intent,
      updatedAt,
    });
    return res.status(201).json({ success: true, data: cache });
  } catch (error) {
    return next(error);
  }
}

async function getTodayUsage(req, res, next) {
  try {
    const dateKey = req.query.date?.toString().trim() || costControlService.todayKey();
    const usage = await costControlService.getUsageForDate(req.user.uid, dateKey);
    return res.status(200).json({ success: true, data: usage });
  } catch (error) {
    return next(error);
  }
}

async function incrementTodayUsage(req, res, next) {
  try {
    const dateKey = req.body?.dateKey?.toString().trim() || costControlService.todayKey();
    await costControlService.recordUsage({
      userId: req.user.uid,
      dateKey,
      usedAi: true,
      tokensUsed: Number(req.body?.tokensUsed || 0),
      cost: Number(req.body?.cost || 0),
      timestamp: req.body?.timestamp?.toString().trim() || new Date().toISOString(),
    });
    const usage = await costControlService.getUsageForDate(req.user.uid, dateKey);
    return res.status(200).json({ success: true, data: usage });
  } catch (error) {
    return next(error);
  }
}

async function logAiUsage(req, res, next) {
  try {
    const logId = req.body?.id?.toString().trim() || `ai-${Date.now()}`;
    const date = req.body?.date?.toString().trim() || '';
    const timestamp = req.body?.timestamp?.toString().trim() || new Date().toISOString();
    const usedAi = req.body?.usedAi == true;
    const cost = Number(req.body?.cost || 0);
    const daily = await AiDailyStat.findOne({ date });
    const userUsage = await UserAiUsageStat.findOne({ userId: req.user.uid });

    await AiUsageLog.findOneAndUpdate(
      { logId },
      {
        logId,
        userId: req.user.uid,
        message: req.body?.message?.toString() || '',
        responseLength: Number(req.body?.responseLength || 0),
        tokensUsed: Number(req.body?.tokensUsed || 0),
        cost,
        costPerRequest: Number(req.body?.costPerRequest || cost),
        timestamp,
        intentType: req.body?.intentType?.toString() || 'ai_needed',
        usedAi,
        source: req.body?.source?.toString() || (usedAi ? 'ai' : 'logic'),
        modelName: req.body?.modelName?.toString() || '',
        cacheKey: req.body?.cacheKey?.toString() || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (date) {
      await AiDailyStat.findOneAndUpdate(
        { date },
        {
          date,
          totalRequests: Number(daily?.totalRequests || 0) + 1,
          totalCost: Number(daily?.totalCost || 0) + cost,
          aiRequests: Number(daily?.aiRequests || 0) + (usedAi ? 1 : 0),
          logicRequests: Number(daily?.logicRequests || 0) + (usedAi ? 0 : 1),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    await UserAiUsageStat.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        totalMessages: Number(userUsage?.totalMessages || 0) + 1,
        aiMessages: Number(userUsage?.aiMessages || 0) + (usedAi ? 1 : 0),
        lastUsed: timestamp,
        dailyUsage: date && userUsage?.dateKey === date ? Number(userUsage?.dailyUsage || 0) + 1 : 1,
        dateKey: date || userUsage?.dateKey || '',
        aiCallsToday:
          date && userUsage?.dateKey === date
            ? Number(userUsage?.aiCallsToday || 0) + (usedAi ? 1 : 0)
            : (usedAi ? 1 : 0),
        tokensToday:
          date && userUsage?.dateKey === date
            ? Number(userUsage?.tokensToday || 0) + Number(req.body?.tokensUsed || 0)
            : Number(req.body?.tokensUsed || 0),
        totalTokens: Number(userUsage?.totalTokens || 0) + Number(req.body?.tokensUsed || 0),
        dailyCost:
          date && userUsage?.dateKey === date
            ? Number(userUsage?.dailyCost || 0) + cost
            : cost,
        totalCost: Number(userUsage?.totalCost || 0) + cost,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ success: true, data: { id: logId } });
  } catch (error) {
    return next(error);
  }
}

async function listAiUsageLogs(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 120)));
    const logs = await AiUsageLog.find({}).sort({ timestamp: -1, _id: -1 }).limit(limit);
    return res.status(200).json({
      success: true,
      data: logs.map((item) => ({
        id: item.logId,
        userId: item.userId,
        message: item.message,
        responseLength: Number(item.responseLength || 0),
        tokensUsed: Number(item.tokensUsed || 0),
        cost: Number(item.cost || 0),
        costPerRequest: Number(item.costPerRequest || 0),
        timestamp: item.timestamp,
        intentType: item.intentType,
        usedAi: item.usedAi,
        source: item.source || 'logic',
        modelName: item.modelName || '',
        cacheKey: item.cacheKey || '',
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function listAiDailyStats(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const stats = await AiDailyStat.find({}).sort({ date: 1, _id: 1 });
    return res.status(200).json({
      success: true,
      data: stats.map((item) => ({
        date: item.date,
        totalRequests: Number(item.totalRequests || 0),
        totalCost: Number(item.totalCost || 0),
        aiRequests: Number(item.aiRequests || 0),
        logicRequests: Number(item.logicRequests || 0),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function listUserAiUsageStats(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const stats = await UserAiUsageStat.find({}).sort({ aiMessages: -1, _id: 1 });
    return res.status(200).json({
      success: true,
      data: stats.map((item) => ({
        userId: item.userId,
        totalMessages: Number(item.totalMessages || 0),
        aiMessages: Number(item.aiMessages || 0),
        lastUsed: item.lastUsed || '',
        dailyUsage: Number(item.dailyUsage || 0),
        aiCallsToday: Number(item.aiCallsToday || 0),
        tokensToday: Number(item.tokensToday || 0),
        totalTokens: Number(item.totalTokens || 0),
        dailyCost: Number(item.dailyCost || 0),
        totalCost: Number(item.totalCost || 0),
        blockedToday: Number(item.blockedToday || 0),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function logAiEvent(req, res, next) {
  try {
    const eventId = req.body?.id?.toString().trim() || `${req.body?.type?.toString().trim() || 'event'}-${Date.now()}`;
    await AiEventLog.findOneAndUpdate(
      { eventId },
      {
        eventId,
        userId: req.user.uid,
        type: req.body?.type?.toString().trim() || 'event',
        message: req.body?.message?.toString() || '',
        prompt: req.body?.prompt?.toString() || '',
        reason: req.body?.reason?.toString() || '',
        intentType: req.body?.intentType?.toString() || '',
        timestamp: req.body?.timestamp?.toString().trim() || new Date().toISOString(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ success: true, data: { id: eventId } });
  } catch (error) {
    return next(error);
  }
}

async function generateProductSpecs(req, res, next) {
  try {
    const productId = req.body?.productId?.toString().trim() || '';
    let source = {
      name: req.body?.name || '',
      brand: req.body?.brand || '',
      category: req.body?.category || '',
      subcategory: req.body?.subcategory || '',
      description: req.body?.description || '',
      attributes: req.body?.attributes || {},
    };

    if (productId) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }
      source = {
        name: product.name || '',
        brand: product.brand || '',
        category: product.category || '',
        subcategory: product.subcategory || '',
        description: product.description || '',
        attributes: product.attributes || {},
      };
    }

    const result = buildDynamicSpecs(source);
    return res.status(200).json({
      success: true,
      data: {
        ...result,
        productId: productId || null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getProductSpecConfig(req, res, next) {
  try {
    const requestedCategory = normalizeCategory(req.query?.category || '', req.query?.subcategory || '');
    const config = CATEGORY_SPEC_CONFIG[requestedCategory] || CATEGORY_SPEC_CONFIG.generic;
    return res.status(200).json({
      success: true,
      data: {
        category: requestedCategory,
        sections: config.sections,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  runAiGateway,
  recommendSize,
  stylistChat,
  stylistRecommendations,
  getChatHistory,
  appendChatHistoryEntry,
  clearUserMemory,
  getSupportCache,
  setSupportCache,
  getTodayUsage,
  incrementTodayUsage,
  logAiUsage,
  listAiUsageLogs,
  listAiDailyStats,
  listUserAiUsageStats,
  logAiEvent,
  generateProductSpecs,
  getProductSpecConfig,
};
