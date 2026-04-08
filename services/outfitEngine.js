const mongoose = require('mongoose');

const Product = require('../models/Product');
const User = require('../models/User');
const UserMemory = require('../models/UserMemory');
const UserStyleProfile = require('../models/UserStyleProfile');
const OutfitInteraction = require('../models/OutfitInteraction');

const ROLE_KEYWORDS = {
  top: [
    'shirt',
    't-shirt',
    'tshirt',
    'tee',
    'top',
    'hoodie',
    'sweatshirt',
    'jacket',
    'blazer',
    'kurta',
    'kurti',
    'blouse',
    'polo',
  ],
  bottom: [
    'jeans',
    'pant',
    'pants',
    'trouser',
    'trousers',
    'chino',
    'shorts',
    'skirt',
    'leggings',
    'jogger',
    'joggers',
    'churidar',
    'salwar',
  ],
  footwear: [
    'shoe',
    'shoes',
    'sneaker',
    'sneakers',
    'loafer',
    'loafers',
    'heel',
    'heels',
    'sandal',
    'sandals',
    'boot',
    'boots',
    'slipper',
    'slippers',
    'runner',
    'running',
  ],
  accessory: [
    'watch',
    'belt',
    'bag',
    'wallet',
    'cap',
    'scarf',
    'sunglass',
    'sunglasses',
    'bracelet',
    'necklace',
    'earring',
    'ring',
    'accessory',
  ],
  onepiece: [
    'dress',
    'gown',
    'saree',
    'co-ord',
    'coord',
    'set',
    'jumpsuit',
    'romper',
    'lehenga',
    'sherwani',
  ],
};

const NEUTRAL_COLORS = new Set([
  'black',
  'white',
  'grey',
  'gray',
  'beige',
  'cream',
  'tan',
  'brown',
  'navy',
  'denim',
]);

const COLOR_KEYWORDS = [
  'black',
  'white',
  'grey',
  'gray',
  'beige',
  'cream',
  'tan',
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
  'lavender',
  'maroon',
  'orange',
  'teal',
];

const STYLE_KEYWORDS = {
  minimal: ['minimal', 'clean', 'classic', 'solid', 'essential'],
  streetwear: ['streetwear', 'oversized', 'cargo', 'graphic', 'hoodie', 'jogger'],
  formal: ['formal', 'office', 'blazer', 'tailored', 'smart', 'trouser'],
  ethnic: ['ethnic', 'kurta', 'lehenga', 'saree', 'sherwani', 'festive'],
  party: ['party', 'sequined', 'shine', 'glam', 'night'],
};

const OCCASION_KEYWORDS = {
  casual: ['casual', 'everyday', 'daily', 'relaxed', 'weekend'],
  party: ['party', 'night', 'club', 'glam'],
  wedding: ['wedding', 'festive', 'bridal', 'sherwani', 'lehenga', 'reception'],
  office: ['office', 'formal', 'work', 'tailored', 'blazer'],
};

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function asText(product) {
  return `${product.name || ''} ${product.category || ''} ${product.description || ''} ${product.outfitType || ''}`.toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uniqueRecent(existing, additions, limit = 18) {
  const merged = [...additions, ...existing]
    .map((item) => (item || '').toString().trim())
    .filter(Boolean);
  return [...new Set(merged)].slice(0, limit);
}

function mapToObject(value) {
  if (!value) {
    return {};
  }
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  return { ...value };
}

function bumpAffinity(mapValue, key, amount) {
  const normalized = (key || '').toString().trim().toLowerCase();
  if (!normalized) {
    return mapValue;
  }
  const next = mapToObject(mapValue);
  next[normalized] = Number(next[normalized] || 0) + amount;
  return next;
}

function topKeys(mapValue, limit = 6) {
  return Object.entries(mapToObject(mapValue))
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, limit)
    .map(([key]) => key);
}

function normalizeBudgetFilter(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.includes('999')) return 'under_999';
  if (normalized.includes('1999')) return 'under_1999';
  if (normalized.includes('2999')) return 'under_2999';
  return normalized;
}

function parseBudgetRange(value) {
  switch (normalizeBudgetFilter(value)) {
    case 'under_999':
      return { min: 0, max: 999 };
    case 'under_1999':
      return { min: 0, max: 1999 };
    case 'under_2999':
      return { min: 0, max: 2999 };
    default:
      return null;
  }
}

function inferColors(product) {
  const text = asText(product);
  return COLOR_KEYWORDS.filter((color) => text.includes(color));
}

function inferOccasion(product) {
  const text = asText(product);
  for (const [occasion, keywords] of Object.entries(OCCASION_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return occasion;
    }
  }
  return 'casual';
}

function inferStyle(product) {
  const text = asText(product);
  for (const [style, keywords] of Object.entries(STYLE_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return style;
    }
  }
  if (inferOccasion(product) === 'office') {
    return 'formal';
  }
  if (inferOccasion(product) === 'wedding') {
    return 'ethnic';
  }
  return 'minimal';
}

function inferRole(product) {
  const outfitType = (product.outfitType || '').toString().trim().toLowerCase();
  if (ROLE_KEYWORDS[outfitType]) {
    return outfitType;
  }

  const text = asText(product);
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return role;
    }
  }
  return 'top';
}

function inferFit(product) {
  const text = asText(product);
  if (text.includes('slim')) return 'slim';
  if (text.includes('oversized') || text.includes('relaxed')) return 'relaxed';
  if (text.includes('structured') || text.includes('tailored')) return 'structured';
  return 'regular';
}

function parseNumeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function classifyBodyShapeFromMeasurements({ chest, waist, hip }) {
  const c = parseNumeric(chest);
  const w = parseNumeric(waist);
  const h = parseNumeric(hip);
  if (c == null || h == null) {
    return 'Unknown';
  }
  const chestHipDiff = c - h;
  const waistRatio = w == null || c <= 0 || h <= 0 ? 0.88 : w / ((c + h) / 2);
  if (waistRatio <= 0.74) {
    return 'Hourglass';
  }
  if (Math.abs(chestHipDiff) <= 4) {
    return 'Rectangle';
  }
  if (h > c) {
    return 'Pear';
  }
  return 'Inverted Triangle';
}

function bodyShapeRules(bodyShape) {
  switch ((bodyShape || '').toLowerCase()) {
    case 'rectangle':
      return {
        preferredStyles: ['layered', 'structured', 'casual', 'formal'],
        preferredRoles: ['top', 'jacket'],
        avoidTags: [],
        reason: 'Layered and structured picks add definition to your shape.',
      };
    case 'pear':
      return {
        preferredStyles: ['bright-top', 'casual', 'formal'],
        preferredRoles: ['top'],
        avoidTags: ['loud-bottom'],
        reason: 'Brighter tops and balanced bottoms complement your proportions.',
      };
    case 'inverted triangle':
      return {
        preferredStyles: ['minimal-shoulder', 'relaxed-bottom', 'casual'],
        preferredRoles: ['bottom'],
        avoidTags: ['padded-shoulder'],
        reason: 'Lower-body emphasis balances shoulder width.',
      };
    case 'hourglass':
      return {
        preferredStyles: ['waist-defined', 'fitted', 'formal', 'casual'],
        preferredRoles: ['top', 'onepiece'],
        avoidTags: [],
        reason: 'Waist-focused silhouettes enhance your natural balance.',
      };
    default:
      return {
        preferredStyles: ['casual', 'formal'],
        preferredRoles: ['top', 'bottom'],
        avoidTags: [],
        reason: 'Matched from fit, style history, and trending products.',
      };
  }
}

function inferProductTags(product, signal) {
  const fromAttributes = (() => {
    const attributes = mapToObject(product.attributes);
    const raw = attributes.tags || attributes.tag || '';
    if (Array.isArray(raw)) {
      return raw.map((item) => item.toString().trim().toLowerCase()).filter(Boolean);
    }
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    }
    return [];
  })();
  const text = asText(product);
  const inferred = [
    signal.fit === 'slim' ? 'slim-fit' : null,
    signal.fit === 'relaxed' ? 'loose' : null,
    signal.occasion === 'casual' ? 'casual' : null,
    signal.occasion === 'office' ? 'formal' : null,
    text.includes('jacket') || text.includes('blazer') ? 'layered' : null,
    text.includes('bright') || text.includes('vibrant') ? 'bright-top' : null,
    text.includes('pad') && text.includes('shoulder') ? 'padded-shoulder' : null,
    signal.role === 'bottom' ? 'relaxed-bottom' : null,
  ].filter(Boolean);
  return [...new Set([...fromAttributes, ...inferred])];
}

function preferredFitForBodyType(bodyType) {
  const normalized = (bodyType || '').toString().trim().toLowerCase();
  if (normalized === 'slim' || normalized === 'athletic') return 'structured';
  if (normalized === 'heavy') return 'relaxed';
  return 'regular';
}

function colorHarmonyScore(anchorColors, candidateColors) {
  if (anchorColors.length === 0 || candidateColors.length === 0) {
    return 0.65;
  }
  const shared = anchorColors.filter((color) => candidateColors.includes(color));
  if (shared.length > 0) {
    return 0.95;
  }
  const anchorNeutral = anchorColors.some((color) => NEUTRAL_COLORS.has(color));
  const candidateNeutral = candidateColors.some((color) => NEUTRAL_COLORS.has(color));
  if (anchorNeutral || candidateNeutral) {
    return 0.86;
  }
  return 0.58;
}

function categorySignal(product) {
  return (product.category || '').toString().trim().toLowerCase();
}

function serializeProductSummary(product) {
  const signal = inferSignals(product);
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
    updatedAt: product.updatedAt || null,
    rating: Number(product.rating || 0),
    reviewCount: Number(product.reviewCount || 0),
    outfitType: product.outfitType || '',
    fabric: product.fabric || '',
    tags: signal.tags,
  };
}

async function resolveUserIdentity(userId) {
  const normalized = (userId || '').toString().trim();
  if (!normalized) {
    return { uid: '', user: null, memory: null, styleProfile: null };
  }

  let user = null;
  if (mongoose.Types.ObjectId.isValid(normalized)) {
    user = await User.findById(normalized);
  }
  if (!user) {
    user = await User.findOne({
      $or: [{ firebaseUid: normalized }, { uid: normalized }, { phone: normalized }],
    });
  }

  const uid = user?.firebaseUid || user?.uid || normalized;
  const [memory, styleProfile] = await Promise.all([
    UserMemory.findOne({ userId: uid }),
    UserStyleProfile.findOne({ userId: uid }),
  ]);

  return { uid, user, memory, styleProfile };
}

async function ensureStyleProfile(userId) {
  const resolved = await resolveUserIdentity(userId);
  if (!resolved.uid) {
    return null;
  }

  if (resolved.styleProfile) {
    return resolved.styleProfile;
  }

  return UserStyleProfile.create({
    userId: resolved.uid,
    bodyType: resolved.memory?.bodyType || '',
    size: resolved.memory?.recommendedSize || resolved.memory?.size || '',
    updatedAtIso: new Date().toISOString(),
  });
}

function inferSignals(product) {
  const base = {
    role: inferRole(product),
    colors: inferColors(product),
    occasion: inferOccasion(product),
    style: inferStyle(product),
    fit: inferFit(product),
    category: categorySignal(product),
    price: Number(product.price || 0),
  };
  return {
    ...base,
    tags: inferProductTags(product, base),
  };
}

function bodyShapeRuleScore(signal, bodyShape) {
  if (!bodyShape || bodyShape === 'Unknown') {
    return 0;
  }
  const rules = bodyShapeRules(bodyShape);
  let score = 0;
  if (rules.preferredRoles.includes(signal.role)) {
    score += 0.1;
  }
  if (rules.preferredStyles.includes(signal.style)) {
    score += 0.08;
  }
  if (Array.isArray(signal.tags) && signal.tags.length > 0) {
    if (rules.preferredStyles.some((styleTag) => signal.tags.includes(styleTag))) {
      score += 0.1;
    }
    if (rules.avoidTags.some((tag) => signal.tags.includes(tag))) {
      score -= 0.12;
    }
  }
  return clamp(score, -0.2, 0.22);
}

async function updateStyleProfileFromProducts({
  userId,
  action,
  products,
}) {
  const profile = await ensureStyleProfile(userId);
  if (!profile) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const interactionCounts = {
    clicks: profile.interactionCounts?.clicks || 0,
    carts: profile.interactionCounts?.carts || 0,
    purchases: profile.interactionCounts?.purchases || 0,
    wishlists: profile.interactionCounts?.wishlists || 0,
    skips: profile.interactionCounts?.skips || 0,
  };

  const categoryAffinity = mapToObject(profile.categoryAffinity);
  const colorAffinity = mapToObject(profile.colorAffinity);
  const occasionAffinity = mapToObject(profile.occasionAffinity);
  const styleAffinity = mapToObject(profile.styleAffinity);
  let preferredCategories = [...(profile.preferredCategories || [])];
  let colorPreference = [...(profile.colorPreference || [])];
  let browsingHistory = [...(profile.browsingHistory || [])];
  let wishlist = [...(profile.wishlist || [])];
  let pastPurchases = [...(profile.pastPurchases || [])];
  let minPrice = Number(profile.priceRange?.min || 0);
  let maxPrice = Number(profile.priceRange?.max || 0);

  const actionWeight =
    action === 'purchase'
      ? 3
      : action === 'wishlist'
        ? 2
        : action === 'cart'
          ? 2
          : action === 'skip'
            ? -1
            : 1;

  for (const product of products) {
    const productId = product._id?.toString() || product.id || '';
    const signal = inferSignals(product);

    if (action !== 'skip') {
      browsingHistory = uniqueRecent(browsingHistory, [productId], 24);
    }
    if (action === 'wishlist') {
      wishlist = uniqueRecent(wishlist, [productId], 24);
    }
    if (action === 'purchase') {
      pastPurchases = uniqueRecent(pastPurchases, [productId], 40);
    }

    if (signal.category) {
      const next = bumpAffinity(categoryAffinity, signal.category, actionWeight);
      Object.assign(categoryAffinity, next);
    }
    for (const color of signal.colors) {
      const next = bumpAffinity(colorAffinity, color, actionWeight);
      Object.assign(colorAffinity, next);
    }
    if (signal.occasion) {
      const next = bumpAffinity(occasionAffinity, signal.occasion, actionWeight);
      Object.assign(occasionAffinity, next);
    }
    if (signal.style) {
      const next = bumpAffinity(styleAffinity, signal.style, actionWeight);
      Object.assign(styleAffinity, next);
    }

    if (actionWeight > 0 && signal.price > 0) {
      minPrice = minPrice == 0 ? signal.price : Math.min(minPrice, signal.price);
      maxPrice = Math.max(maxPrice, signal.price);
    }
  }

  preferredCategories = topKeys(categoryAffinity);
  colorPreference = topKeys(colorAffinity);

  if (action === 'view' || action === 'click') {
    interactionCounts.clicks += 1;
  } else if (action === 'cart') {
    interactionCounts.carts += 1;
  } else if (action === 'wishlist') {
    interactionCounts.wishlists += 1;
  } else if (action === 'purchase') {
    interactionCounts.purchases += 1;
  } else if (action === 'skip') {
    interactionCounts.skips += 1;
  }

  profile.preferredCategories = preferredCategories;
  profile.colorPreference = colorPreference;
  profile.browsingHistory = browsingHistory;
  profile.wishlist = wishlist;
  profile.pastPurchases = pastPurchases;
  profile.priceRange = {
    min: Number.isFinite(minPrice) ? minPrice : 0,
    max: Number.isFinite(maxPrice) ? maxPrice : 0,
  };
  profile.categoryAffinity = categoryAffinity;
  profile.colorAffinity = colorAffinity;
  profile.occasionAffinity = occasionAffinity;
  profile.styleAffinity = styleAffinity;
  profile.interactionCounts = interactionCounts;
  profile.updatedAtIso = nowIso;

  if (!profile.bodyType || !profile.size) {
    const resolved = await resolveUserIdentity(userId);
    if (!profile.bodyType) {
      profile.bodyType = resolved.memory?.bodyType || '';
    }
    if (!profile.size) {
      profile.size = resolved.memory?.recommendedSize || resolved.memory?.size || '';
    }
  }

  await profile.save();
  return profile;
}

async function trackOutfitInteraction({
  userId,
  action,
  outfitId = '',
  productId = '',
  itemIds = [],
  filters = {},
  metadata = {},
}) {
  const resolved = await resolveUserIdentity(userId);
  if (!resolved.uid) {
    return null;
  }

  const uniqueIds = [...new Set(itemIds.map((item) => item.toString()))].filter(Boolean);
  const allProductIds = [...new Set([productId, ...uniqueIds])].filter(Boolean);
  const validProductIds = allProductIds.filter((item) => mongoose.Types.ObjectId.isValid(item));
  const products = validProductIds.length > 0
    ? await Product.find({ _id: { $in: validProductIds } })
    : [];

  const items = products.map((product) => {
    const signal = inferSignals(product);
    return {
      productId: product._id,
      role: signal.role,
      category: signal.category,
    };
  });

  await OutfitInteraction.create({
    userId: resolved.uid,
    outfitId: (outfitId || '').toString().trim(),
    action: (action || '').toString().trim().toLowerCase(),
    productId:
      productId && mongoose.Types.ObjectId.isValid(productId)
        ? productId
        : null,
    itemIds: validProductIds,
    items,
    filters,
    metadata,
    createdAtIso: new Date().toISOString(),
  });

  if (products.length > 0) {
    await updateStyleProfileFromProducts({
      userId: resolved.uid,
      action,
      products,
    });
  }

  return true;
}

function pairPreference(role, occasion) {
  if (role === 'onepiece') {
    return ['footwear', 'accessory'];
  }
  if (occasion === 'wedding') {
    return ['bottom', 'footwear', 'accessory'];
  }
  return ['bottom', 'footwear', 'accessory'];
}

function productPreferenceScore(product, signal, profile, filters, anchorSignal) {
  let score = 0.45;

  const preferredCategories = (profile?.preferredCategories || []).map((item) => item.toLowerCase());
  if (preferredCategories.includes(signal.category)) {
    score += 0.2;
  }

  const preferredColors = (profile?.colorPreference || []).map((item) => item.toLowerCase());
  if (signal.colors.some((color) => preferredColors.includes(color))) {
    score += 0.12;
  }

  if (profile?.bodyType) {
    const preferredFit = preferredFitForBodyType(profile.bodyType);
    if (preferredFit === signal.fit || (preferredFit === 'regular' && signal.fit === 'regular')) {
      score += 0.1;
    }
  }
  if (profile?.bodyShape) {
    score += bodyShapeRuleScore(signal, profile.bodyShape);
  }

  const desiredSize = (profile?.size || '').toString().trim().toUpperCase();
  if (desiredSize && Array.isArray(product.sizes) && product.sizes.map((item) => item.toUpperCase()).includes(desiredSize)) {
    score += 0.08;
  }

  const budgetRange = parseBudgetRange(filters?.budget);
  if (budgetRange != null) {
    if (signal.price >= budgetRange.min && signal.price <= budgetRange.max) {
      score += 0.12;
    } else {
      score -= 0.08;
    }
  } else if ((profile?.priceRange?.max || 0) > 0) {
    const profileMin = Number(profile.priceRange.min || 0);
    const profileMax = Number(profile.priceRange.max || 0);
    if (signal.price >= profileMin * 0.7 && signal.price <= profileMax * 1.2) {
      score += 0.08;
    }
  }

  if (filters?.occasion && filters.occasion == signal.occasion) {
    score += 0.14;
  }
  if (filters?.style && filters.style == signal.style) {
    score += 0.12;
  }

  if (anchorSignal) {
    score += colorHarmonyScore(anchorSignal.colors, signal.colors) * 0.12;
    if (anchorSignal.occasion === signal.occasion) {
      score += 0.1;
    }
    if (anchorSignal.style === signal.style) {
      score += 0.08;
    }
  }

  return clamp(score, 0, 1.2);
}

async function similarUsersScore(itemIds, filters) {
  const query = {
    action: { $in: ['click', 'purchase', 'wishlist'] },
  };
  if (itemIds.length > 0) {
    query.itemIds = { $in: itemIds };
  }
  if (filters?.occasion) {
    query['filters.occasion'] = filters.occasion;
  }
  if (filters?.style) {
    query['filters.style'] = filters.style;
  }

  const matches = await OutfitInteraction.countDocuments(query);
  return clamp(matches / 25, 0, 1);
}

function inventoryScore(items) {
  if (items.length === 0) {
    return 0;
  }
  const value = items.reduce((sum, item) => sum + clamp((Number(item.stock || 0) / 20), 0, 1), 0);
  return value / items.length;
}

function trendingScore(items) {
  if (items.length === 0) {
    return 0;
  }
  const value = items.reduce((sum, item) => {
    const ratingScore = clamp(Number(item.rating || 0) / 5, 0, 1);
    const reviewScore = clamp(Number(item.reviewCount || 0) / 50, 0, 1);
    return sum + ((ratingScore * 0.7) + (reviewScore * 0.3));
  }, 0);
  return value / items.length;
}

function buildOutfitTitle(occasion, style, baseProduct) {
  const name = (baseProduct.name || '').trim();
  if (occasion === 'wedding') return 'Wedding Statement Look';
  if (occasion === 'office') return 'Office Ready Edit';
  if (style === 'streetwear') return 'Streetwear Layered Look';
  if (style === 'formal') return 'Smart Casual Look';
  if (style === 'ethnic') return 'Festive Style Pick';
  return name ? `${name.split(' ')[0]} Styling Pick` : 'Curated Outfit';
}

async function buildOutfitFromBase({
  baseProduct,
  baseSignal,
  classifiedProducts,
  profile,
  filters,
  limitAccessories = true,
}) {
  const selected = [baseProduct];
  const selectedIds = new Set([baseProduct._id.toString()]);
  const itemSignals = new Map([[baseProduct._id.toString(), baseSignal]]);
  const requiredRoles = pairPreference(baseSignal.role, filters.occasion || baseSignal.occasion);

  for (const role of requiredRoles) {
    const pool = classifiedProducts
      .filter((entry) => entry.signal.role === role)
      .filter((entry) => !selectedIds.has(entry.product._id.toString()))
      .sort((left, right) => {
        const leftScore = productPreferenceScore(left.product, left.signal, profile, filters, baseSignal);
        const rightScore = productPreferenceScore(right.product, right.signal, profile, filters, baseSignal);
        return rightScore - leftScore;
      });

    const best = pool[0];
    if (!best) {
      continue;
    }

    const bestScore = productPreferenceScore(best.product, best.signal, profile, filters, baseSignal);
    if (role === 'accessory' && limitAccessories && bestScore < 0.62) {
      continue;
    }

    selected.push(best.product);
    selectedIds.add(best.product._id.toString());
    itemSignals.set(best.product._id.toString(), best.signal);
  }

  if (selected.length < 2) {
    return null;
  }

  const preferenceScore =
    selected.reduce((sum, item) => {
      const signal = itemSignals.get(item._id.toString()) || inferSignals(item);
      return sum + productPreferenceScore(item, signal, profile, filters, baseSignal);
    }, 0) / selected.length;

  const trendScore = trendingScore(selected);
  const similarScore = await similarUsersScore(selected.map((item) => item._id), filters);
  const inventory = inventoryScore(selected);

  const totalScore = clamp(
    (preferenceScore * 0.4) + (trendScore * 0.2) + (similarScore * 0.2) + (inventory * 0.2),
    0,
    1,
  );

  const title = buildOutfitTitle(filters.occasion || baseSignal.occasion, filters.style || baseSignal.style, baseProduct);
  const totalPrice = selected.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const outfitId = [
    baseProduct._id.toString(),
    ...selected.slice(1).map((item) => item._id.toString()),
  ].join('-');

  const bodyShape = profile?.bodyShape || 'Unknown';
  const bodyReason = bodyShapeRules(bodyShape).reason;
  return {
    outfitId,
    title,
    items: selected.map(serializeProductSummary),
    totalPrice,
    matchScore: Math.round(totalScore * 100),
    occasion: filters.occasion || baseSignal.occasion,
    style: filters.style || baseSignal.style,
    reasoning: `Ranked from body-shape rules, user preferences, trending demand, behavior similarity, and inventory depth.`,
    bodyTypeLabel: bodyShape,
    bodyReason,
  };
}

async function generateOutfitRecommendations({
  userId = '',
  productId = '',
  occasion = '',
  budget = '',
  style = '',
  limit = 6,
}) {
  const resolved = await resolveUserIdentity(userId);
  const profile = resolved.styleProfile || await ensureStyleProfile(resolved.uid || userId);
  const bodyShape = classifyBodyShapeFromMeasurements({
    chest: resolved.memory?.chestCm,
    waist: resolved.memory?.waistCm,
    hip: resolved.memory?.hipCm,
  });
  if (profile && !profile.bodyShape) {
    profile.bodyShape = bodyShape;
  }
  if (profile) {
    profile.bodyShape = bodyShape;
  }
  const filters = {
    occasion: (occasion || '').toString().trim().toLowerCase(),
    budget: normalizeBudgetFilter(budget),
    style: (style || '').toString().trim().toLowerCase(),
  };

  const query = {
    isActive: true,
    stock: { $gt: 0 },
  };

  if (filters.occasion === 'wedding') {
    query.category = { $regex: 'wedding|ethnic|festive', $options: 'i' };
  }

  const products = await Product.find(query)
    .sort({ rating: -1, reviewCount: -1, createdAt: -1 })
    .limit(160);

  const classifiedProducts = products.map((product) => ({
    product,
    signal: inferSignals(product),
  }));

  const budgetRange = parseBudgetRange(filters.budget);
  const filteredProducts = classifiedProducts.filter((entry) => {
    if (budgetRange && Number(entry.product.price || 0) > budgetRange.max) {
      return false;
    }
    if (filters.occasion && entry.signal.occasion !== filters.occasion) {
      return false;
    }
    if (filters.style && entry.signal.style !== filters.style) {
      return false;
    }
    return true;
  });

  const activePool = filteredProducts.length > 0 ? filteredProducts : classifiedProducts;
  const anchor = productId && mongoose.Types.ObjectId.isValid(productId)
    ? activePool.find((entry) => entry.product._id.toString() === productId) ||
      classifiedProducts.find((entry) => entry.product._id.toString() === productId)
    : null;

  const baseCandidates = anchor
    ? [anchor]
    : activePool
        .filter((entry) => ['top', 'onepiece'].includes(entry.signal.role))
        .sort((left, right) => {
          const leftScore = productPreferenceScore(left.product, left.signal, profile, filters, null);
          const rightScore = productPreferenceScore(right.product, right.signal, profile, filters, null);
          return rightScore - leftScore;
        })
        .slice(0, Math.max(limit * 2, 10));

  const outfits = [];
  const seen = new Set();
  for (const entry of baseCandidates) {
    const outfit = await buildOutfitFromBase({
      baseProduct: entry.product,
      baseSignal: entry.signal,
      classifiedProducts: activePool,
      profile,
      filters,
      limitAccessories: !anchor,
    });
    if (!outfit || seen.has(outfit.outfitId)) {
      continue;
    }
    seen.add(outfit.outfitId);
    outfits.push(outfit);
    if (outfits.length >= limit) {
      break;
    }
  }

  outfits.sort((left, right) => right.matchScore - left.matchScore);
  return outfits;
}

async function recommendProductsForBodyType({
  userId = '',
  limit = 10,
}) {
  const resolved = await resolveUserIdentity(userId);
  const bodyShape = classifyBodyShapeFromMeasurements({
    chest: resolved.memory?.chestCm,
    waist: resolved.memory?.waistCm,
    hip: resolved.memory?.hipCm,
  });
  const rules = bodyShapeRules(bodyShape);
  const products = await Product.find({
    isActive: true,
    stock: { $gt: 0 },
  })
    .sort({ rating: -1, reviewCount: -1, purchaseCount: -1, createdAt: -1 })
    .limit(180);
  const ranked = products
    .map((product) => {
      const signal = inferSignals(product);
      let score = 0.5;
      score += bodyShapeRuleScore(signal, bodyShape);
      score += clamp((Number(product.demandScore || 0) / 10), 0, 0.15);
      score += clamp((Number(product.purchaseCount || 0) / 200), 0, 0.12);
      return { product, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(30, limit)));
  return {
    bodyType: bodyShape,
    recommended: ranked.map((entry) => entry.product._id.toString()),
    products: ranked.map((entry) => serializeProductSummary(entry.product)),
    reason: 'Enhances your body shape',
    detail: rules.reason,
  };
}

module.exports = {
  ensureStyleProfile,
  generateOutfitRecommendations,
  recommendProductsForBodyType,
  resolveUserIdentity,
  trackOutfitInteraction,
  updateStyleProfileFromProducts,
};
