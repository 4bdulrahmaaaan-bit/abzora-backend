const mongoose = require('mongoose');

const Product = require('../models/Product');
const Review = require('../models/Review');
const Store = require('../models/Store');

function serializeReview(review) {
  if (!review) {
    return null;
  }

  const source = typeof review.toObject === 'function' ? review.toObject() : review;
  return {
    id: source._id?.toString() || source.id || '',
    userId: source.userId || '',
    userName: source.userName || '',
    targetId: source.targetId?.toString() || '',
    targetType: source.targetType || 'product',
    rating: Number(source.rating || 0),
    comment: source.comment || '',
    imagePath: source.imagePath || '',
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function ensureReviewTarget(targetId, targetType) {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    return null;
  }

  if (targetType === 'product') {
    return Product.findById(targetId);
  }
  if (targetType === 'store') {
    return Store.findById(targetId);
  }
  return null;
}

async function syncTargetRating(targetId, targetType) {
  const targetObjectId = new mongoose.Types.ObjectId(targetId);
  const [summary] = await Review.aggregate([
    {
      $match: {
        targetId: targetObjectId,
        targetType,
      },
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 },
      },
    },
  ]);

  const nextValues = {
    rating: Number(summary?.averageRating || 0),
    reviewCount: Number(summary?.reviewCount || 0),
  };

  if (targetType === 'product') {
    await Product.findByIdAndUpdate(targetId, nextValues);
    return;
  }

  if (targetType === 'store') {
    await Store.findByIdAndUpdate(targetId, nextValues);
  }
}

async function listProductReviews(req, res, next) {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const reviews = await Review.find({ targetId: productId, targetType: 'product' }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: reviews.map(serializeReview) });
  } catch (error) {
    return next(error);
  }
}

async function listStoreReviews(req, res, next) {
  try {
    const { storeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }

    const reviews = await Review.find({ targetId: storeId, targetType: 'store' }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: reviews.map(serializeReview) });
  } catch (error) {
    return next(error);
  }
}

async function saveReview(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { id, targetId, targetType, rating, comment, imagePath, createdAt, userName } = req.body || {};
    const normalizedTargetType = targetType?.toString().trim().toLowerCase();
    const normalizedComment = comment?.toString().trim() || '';
    const normalizedImagePath = imagePath?.toString().trim() || '';
    const normalizedUserName = userName?.toString().trim() || req.user.name || 'ABZORA Member';
    const numericRating = Number(rating);

    if (!targetId || !['product', 'store'].includes(normalizedTargetType)) {
      return res.status(400).json({ success: false, message: 'targetId and a valid targetType are required.' });
    }
    if (Number.isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }

    const target = await ensureReviewTarget(targetId, normalizedTargetType);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Review target not found.' });
    }

    let review = null;
    if (id && mongoose.Types.ObjectId.isValid(id)) {
      review = await Review.findById(id);
      if (review && review.userId !== req.user.uid) {
        return res.status(403).json({ success: false, message: 'You can only update your own review.' });
      }
    }

    if (!review) {
      review = await Review.findOne({
        userId: req.user.uid,
        targetId,
        targetType: normalizedTargetType,
      });
    }

    if (!review) {
      review = new Review({
        userId: req.user.uid,
        targetId,
        targetType: normalizedTargetType,
        createdAt: createdAt ? new Date(createdAt) : new Date(),
      });
    }

    review.userName = normalizedUserName;
    review.rating = numericRating;
    review.comment = normalizedComment;
    review.imagePath = normalizedImagePath;

    await review.save();
    await syncTargetRating(targetId, normalizedTargetType);

    return res.status(200).json({ success: true, data: serializeReview(review) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteReview(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid review id.' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found.' });
    }
    if (review.userId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only delete your own review.' });
    }

    const targetId = review.targetId?.toString() || '';
    const targetType = review.targetType;
    await review.deleteOne();
    if (targetId && targetType) {
      await syncTargetRating(targetId, targetType);
    }

    return res.status(200).json({ success: true, data: { id } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listProductReviews,
  listStoreReviews,
  saveReview,
  deleteReview,
};
