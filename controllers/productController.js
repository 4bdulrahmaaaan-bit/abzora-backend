const mongoose = require('mongoose');

const { sanitizeAttributes } = require('../config/productAttributeConfig');
const Product = require('../models/Product');
const Store = require('../models/Store');

function serializeStoreSummary(store) {
  if (!store) {
    return null;
  }

  return {
    id: store._id?.toString() || store.id || '',
    name: store.name || '',
    rating: Number(store.rating || 0),
    logoUrl: store.logoUrl || '',
  };
}

function serializeProduct(product, options = {}) {
  if (!product) {
    return null;
  }

  const source = typeof product.toObject === 'function' ? product.toObject() : product;
  const populatedStore =
    options.store ||
    (source.storeId && typeof source.storeId === 'object' ? source.storeId : null);

  return {
    id: source._id?.toString() || source.id || '',
    name: source.name || '',
    brand: source.brand || populatedStore?.name || '',
    price: Number(source.price || 0),
    basePrice: source.basePrice == null ? null : Number(source.basePrice),
    dynamicPrice: source.dynamicPrice == null ? null : Number(source.dynamicPrice),
    originalPrice: source.originalPrice == null ? null : Number(source.originalPrice),
    description: source.description || '',
    stock: Number(source.stock || 0),
    category: source.category || '',
    subcategory: source.subcategory || '',
    images: Array.isArray(source.images) ? source.images : [],
    sizes: Array.isArray(source.sizes) && source.sizes.length > 0 ? source.sizes : ['S', 'M', 'L'],
    demandScore: Number(source.demandScore || 0),
    viewCount: Number(source.viewCount || 0),
    cartCount: Number(source.cartCount || 0),
    purchaseCount: Number(source.purchaseCount || 0),
    rating: Number(source.rating || 0),
    reviewCount: Number(source.reviewCount || 0),
    outfitType: source.outfitType || '',
    fabric: source.fabric || '',
    attributes: source.attributes ? Object.fromEntries(Object.entries(source.attributes)) : {},
    storeId: populatedStore ? populatedStore._id?.toString() || populatedStore.id || '' : source.storeId?.toString() || '',
    store: populatedStore ? serializeStoreSummary(populatedStore) : null,
    isActive: Boolean(source.isActive),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function createProduct(req, res, next) {
  try {
    const { name, brand, price, images, storeId, stock, category, subcategory, description, attributes } = req.body || {};
    const normalizedName = name?.toString().trim() || '';
    const normalizedCategory = category?.toString().trim() || '';
    const normalizedDescription = description?.toString().trim() || '';
    const normalizedPrice = Number(price);
    const normalizedStock = Number(stock || 0);

    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!normalizedName || !normalizedCategory || !storeId || Number.isNaN(normalizedPrice)) {
      return res.status(400).json({
        success: false,
        message: 'name, price, category, and storeId are required.',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }
    if (normalizedPrice < 0) {
      return res.status(400).json({ success: false, message: 'Price must be zero or greater.' });
    }
    if (normalizedStock < 0) {
      return res.status(400).json({ success: false, message: 'Stock cannot be negative.' });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user?.uid) {
      return res.status(403).json({
        success: false,
        message: 'You can only add products to your own store.',
      });
    }

    const normalizedBrand = brand?.toString().trim() || '';

    const product = await Product.create({
      name: normalizedName,
      brand: normalizedBrand,
      price: normalizedPrice,
      images: Array.isArray(images)
          ? images.map((item) => item?.toString().trim()).filter(Boolean)
          : [],
      storeId,
      stock: normalizedStock,
      category: normalizedCategory,
      subcategory: subcategory?.toString().trim() || '',
      description: normalizedDescription,
      attributes: sanitizeAttributes(subcategory?.toString().trim() || normalizedCategory, attributes),
    });

    return res.status(201).json({
      success: true,
      data: serializeProduct(product, { store }),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listProducts(req, res, next) {
  try {
    const query = { isActive: true };
    if (req.query.storeId && mongoose.Types.ObjectId.isValid(req.query.storeId)) {
      query.storeId = req.query.storeId;
    }
    if (req.query.category) {
      query.category = req.query.category.toString().trim();
    }

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .populate('storeId', 'name rating logoUrl');

    return res.status(200).json({ success: true, data: products.map(serializeProduct) });
  } catch (error) {
    return next(error);
  }
}

async function getProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id).populate('storeId', 'name rating logoUrl');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    return res.status(200).json({ success: true, data: serializeProduct(product) });
  } catch (error) {
    return next(error);
  }
}

async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const store = await Store.findById(product.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only update products from your own store.' });
    }

    const { name, brand, price, images, stock, category, subcategory, description, attributes, isActive } = req.body || {};
    const normalizedName = name?.toString().trim() || product.name;
    const normalizedBrand =
      brand == null
        ? (product.brand || '')
        : (brand?.toString().trim() || '');
    const normalizedCategory = category?.toString().trim() || product.category;
    const normalizedPrice = price == null ? product.price : Number(price);
    const normalizedStock = stock == null ? product.stock : Number(stock);

    if (!normalizedName || !normalizedCategory || Number.isNaN(normalizedPrice)) {
      return res.status(400).json({
        success: false,
        message: 'name, price, and category are required.',
      });
    }
    if (normalizedPrice < 0) {
      return res.status(400).json({ success: false, message: 'Price must be zero or greater.' });
    }
    if (normalizedStock < 0) {
      return res.status(400).json({ success: false, message: 'Stock cannot be negative.' });
    }

    product.name = normalizedName;
    product.brand = normalizedBrand;
    product.price = normalizedPrice;
    product.stock = normalizedStock;
    product.category = normalizedCategory;
    product.subcategory = subcategory == null ? product.subcategory : subcategory.toString().trim();
    product.description = description?.toString().trim() ?? product.description;
    if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
      product.attributes = sanitizeAttributes(
        (subcategory == null ? product.subcategory : subcategory.toString().trim()) || normalizedCategory,
        attributes,
      );
    }
    if (Array.isArray(images)) {
      product.images = images.map((item) => item?.toString().trim()).filter(Boolean);
    }
    if (typeof isActive === 'boolean') {
      product.isActive = isActive;
    }
    await product.save();

    return res.status(200).json({ success: true, data: serializeProduct(product, { store }) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const store = await Store.findById(product.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only delete products from your own store.' });
    }

    await product.deleteOne();
    return res.status(200).json({ success: true, data: { id } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createProduct,
  listProducts,
  getProduct,
  updateProduct,
  deleteProduct,
};
