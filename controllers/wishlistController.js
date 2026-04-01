const mongoose = require('mongoose');

const Product = require('../models/Product');
const WishlistItem = require('../models/WishlistItem');
const { trackOutfitInteraction } = require('../services/outfitEngine');

function serializeWishlistItem(item) {
  const source = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: source._id?.toString() || source.id || '',
    productId: source.productId?.toString() || '',
    storeId: source.storeId || '',
    name: source.name || '',
    price: Number(source.price || 0),
    image: source.image || '',
    addedAt: source.addedAt || source.createdAt || null,
  };
}

async function listWishlist(req, res, next) {
  try {
    const items = await WishlistItem.find({ userId: req.user.uid }).sort({ addedAt: -1, createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: items.map(serializeWishlistItem),
    });
  } catch (error) {
    return next(error);
  }
}

async function addWishlistItem(req, res, next) {
  try {
    const productId = req.body?.productId?.toString() || '';
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const item = await WishlistItem.findOneAndUpdate(
      { userId: req.user.uid, productId },
      {
        userId: req.user.uid,
        productId,
        storeId: product.storeId?.toString() || '',
        name: product.name,
        price: Number(product.price || 0),
        image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : '',
        addedAt: new Date(),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    try {
      await trackOutfitInteraction({
        userId: req.user.uid,
        action: 'wishlist',
        productId,
        itemIds: [productId],
        metadata: {
          source: 'wishlist_controller',
        },
      });
    } catch (trackingError) {
      console.warn('Wishlist outfit tracking failed:', trackingError.message);
    }

    return res.status(201).json({ success: true, data: serializeWishlistItem(item) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(200).json({ success: true, data: null });
    }
    return next(error);
  }
}

async function removeWishlistItem(req, res, next) {
  try {
    const productId = req.params.productId?.toString() || '';
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }

    await WishlistItem.findOneAndDelete({
      userId: req.user.uid,
      productId,
    });

    return res.status(200).json({ success: true, data: { productId } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listWishlist,
  addWishlistItem,
  removeWishlistItem,
};
