const mongoose = require('mongoose');

const ArTryOnLook = require('../models/ArTryOnLook');
const CommunityPost = require('../models/CommunityPost');
const InfluencerLook = require('../models/InfluencerLook');
const LookShare = require('../models/LookShare');
const Product = require('../models/Product');

const FEEDBACK_REACTIONS = new Set(['looks_good', 'must_buy', 'not_great']);

function getAuthUserId(req) {
  return req.user?.uid || req.user?.firebaseUid || req.user?.id || '';
}

function toObjectIdArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => value?.toString?.().trim?.() || '')
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

function sanitizeCaption(value) {
  return (value || '').toString().trim().slice(0, 280);
}

function normalizeImageUrl(value) {
  const raw = (value || '').toString().trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? raw : '';
  } catch (_) {
    return '';
  }
}

function shareLinkForCode(code) {
  const base = (process.env.PUBLIC_WEB_BASE_URL || process.env.BACKEND_BASE_URL || '').trim();
  if (!base) {
    return `/look/${code}`;
  }
  return `${base.replace(/\/+$/, '')}/look/${code}`;
}

function nextShareCode() {
  return `look_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function feedbackCountField(reaction) {
  if (reaction === 'looks_good') return 'looksGood';
  if (reaction === 'must_buy') return 'mustBuy';
  return 'notGreat';
}

async function shareLook(req, res, next) {
  try {
    const userId = getAuthUserId(req);
    const lookId = req.body?.lookId?.toString().trim() || '';
    let imageUrl = normalizeImageUrl(req.body?.imageUrl);
    let productIds = toObjectIdArray(req.body?.productIds);

    if (lookId) {
      if (!mongoose.Types.ObjectId.isValid(lookId)) {
        return res.status(400).json({ success: false, message: 'Invalid lookId.' });
      }
      const look = await ArTryOnLook.findById(lookId).lean();
      if (!look) {
        return res.status(404).json({ success: false, message: 'Look not found.' });
      }
      imageUrl = imageUrl || normalizeImageUrl(look.imageUrl);
      if (!productIds.length && look.productId) {
        productIds = [new mongoose.Types.ObjectId(look.productId)];
      }
    }

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Valid imageUrl is required.' });
    }

    const share = await LookShare.create({
      shareCode: nextShareCode(),
      userId,
      lookId: lookId && mongoose.Types.ObjectId.isValid(lookId) ? new mongoose.Types.ObjectId(lookId) : null,
      imageUrl,
      caption: sanitizeCaption(req.body?.caption),
      outfitId: req.body?.outfitId?.toString().trim() || '',
      productIds,
      source: req.body?.source?.toString().trim() || 'ar_live',
      visibility: req.body?.visibility?.toString().trim() === 'private' ? 'private' : 'public',
    });

    return res.status(201).json({
      success: true,
      data: {
        id: share._id?.toString() || '',
        shareCode: share.shareCode,
        shareLink: shareLinkForCode(share.shareCode),
        imageUrl: share.imageUrl,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getSharedLook(req, res, next) {
  try {
    const id = req.params.id?.toString().trim() || '';
    const query = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { shareCode: id }] }
      : { shareCode: id };

    const look = await LookShare.findOne(query)
      .populate('productIds', 'name images price category')
      .lean();

    if (!look || look.visibility === 'private') {
      return res.status(404).json({ success: false, message: 'Shared look not found.' });
    }

    await LookShare.updateOne({ _id: look._id }, { $inc: { viewCount: 1 } });

    return res.status(200).json({
      success: true,
      data: {
        id: look._id?.toString() || '',
        shareCode: look.shareCode || '',
        imageUrl: look.imageUrl || '',
        caption: look.caption || '',
        votes: look.feedbackCounts || { looksGood: 0, mustBuy: 0, notGreat: 0 },
        productIds: Array.isArray(look.productIds)
          ? look.productIds.map((product) => product?._id?.toString?.() || product?.toString?.() || '').filter(Boolean)
          : [],
        products: Array.isArray(look.productIds)
          ? look.productIds
              .filter((product) => product && typeof product === 'object')
              .map((product) => ({
                id: product._id?.toString() || '',
                name: product.name || '',
                image: Array.isArray(product.images) ? product.images[0] || '' : '',
                price: Number(product.price || 0),
                category: product.category || '',
              }))
          : [],
        createdAt: look.createdAt || null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function voteSharedLook(req, res, next) {
  try {
    const userId = getAuthUserId(req);
    const id = req.params.id?.toString().trim() || '';
    const reaction = req.body?.reaction?.toString().trim().toLowerCase() || '';
    if (!FEEDBACK_REACTIONS.has(reaction)) {
      return res.status(400).json({
        success: false,
        message: 'reaction must be one of: looks_good, must_buy, not_great',
      });
    }

    const query = mongoose.Types.ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { shareCode: id }] }
      : { shareCode: id };
    const look = await LookShare.findOne(query);
    if (!look) {
      return res.status(404).json({ success: false, message: 'Shared look not found.' });
    }

    const previousReaction = (look.feedbackByUser?.get(userId) || '').toString();
    if (previousReaction === reaction) {
      return res.status(200).json({
        success: true,
        data: {
          votes: look.feedbackCounts,
          reaction,
        },
      });
    }

    if (previousReaction) {
      const previousField = feedbackCountField(previousReaction);
      look.feedbackCounts[previousField] = Math.max(0, Number(look.feedbackCounts[previousField] || 0) - 1);
    }

    const nextField = feedbackCountField(reaction);
    look.feedbackCounts[nextField] = Number(look.feedbackCounts[nextField] || 0) + 1;
    look.feedbackByUser.set(userId, reaction);
    await look.save();

    return res.status(200).json({
      success: true,
      data: {
        votes: look.feedbackCounts,
        reaction,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getTrendingLooks(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(24, Number(req.query.limit || 12)));
    const looks = await InfluencerLook.find({ isActive: true })
      .sort({ isTrending: -1, priority: -1, 'stats.tryCount': -1, createdAt: -1 })
      .limit(limit)
      .populate('productIds', 'name images price category');

    return res.status(200).json({
      success: true,
      data: looks.map((look) => ({
        id: look._id?.toString() || '',
        influencerId: look.influencerId || '',
        influencerName: look.influencerName || '',
        influencerHandle: look.influencerHandle || '',
        title: look.title || '',
        description: look.description || '',
        coverImageUrl: look.coverImageUrl || '',
        styleTags: Array.isArray(look.styleTags) ? look.styleTags : [],
        occasionTags: Array.isArray(look.occasionTags) ? look.occasionTags : [],
        ctaLabel: look.ctaLabel || 'Try This Look',
        isTrending: Boolean(look.isTrending),
        productIds: Array.isArray(look.productIds)
          ? look.productIds.map((product) => product?._id?.toString?.() || product?.toString?.() || '').filter(Boolean)
          : [],
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function getInfluencerLook(req, res, next) {
  try {
    const id = req.params.id?.toString().trim() || '';
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid look id.' });
    }

    const look = await InfluencerLook.findById(id).populate('productIds', 'name images price category');
    if (!look || !look.isActive) {
      return res.status(404).json({ success: false, message: 'Look not found.' });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: look._id?.toString() || '',
        influencerId: look.influencerId || '',
        influencerName: look.influencerName || '',
        influencerHandle: look.influencerHandle || '',
        title: look.title || '',
        description: look.description || '',
        coverImageUrl: look.coverImageUrl || '',
        styleTags: Array.isArray(look.styleTags) ? look.styleTags : [],
        occasionTags: Array.isArray(look.occasionTags) ? look.occasionTags : [],
        ctaLabel: look.ctaLabel || 'Try This Look',
        products: Array.isArray(look.productIds)
          ? look.productIds
              .filter((product) => product && typeof product === 'object')
              .map((product) => ({
                id: product._id?.toString() || '',
                name: product.name || '',
                image: Array.isArray(product.images) ? product.images[0] || '' : '',
                price: Number(product.price || 0),
                category: product.category || '',
              }))
          : [],
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getFeed(req, res, next) {
  try {
    const limit = Math.max(1, Math.min(24, Number(req.query.limit || 12)));
    const posts = await CommunityPost.find({ status: 'active' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('lookShareId')
      .populate('productIds', 'name images price category')
      .lean();

    return res.status(200).json({
      success: true,
      data: posts.map((post) => ({
        id: post._id?.toString() || '',
        userId: post.userId || '',
        imageUrl: post.imageUrl || post.lookShareId?.imageUrl || '',
        caption: post.caption || '',
        likeCount: Number(post.likeCount || 0),
        commentCount: Number(post.commentCount || 0),
        tags: Array.isArray(post.tags) ? post.tags : [],
        lookShareId: post.lookShareId?._id?.toString?.() || '',
        tryThisLookId: post.lookShareId?.shareCode || '',
        products: Array.isArray(post.productIds)
          ? post.productIds
              .filter((product) => product && typeof product === 'object')
              .map((product) => ({
                id: product._id?.toString() || '',
                name: product.name || '',
                image: Array.isArray(product.images) ? product.images[0] || '' : '',
                price: Number(product.price || 0),
                category: product.category || '',
              }))
          : [],
        createdAt: post.createdAt || null,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function createPost(req, res, next) {
  try {
    const userId = getAuthUserId(req);
    const lookShareId = req.body?.lookShareId?.toString().trim() || '';
    let imageUrl = normalizeImageUrl(req.body?.imageUrl);
    let productIds = toObjectIdArray(req.body?.productIds);

    if (lookShareId) {
      if (!mongoose.Types.ObjectId.isValid(lookShareId)) {
        return res.status(400).json({ success: false, message: 'Invalid lookShareId.' });
      }
      const look = await LookShare.findById(lookShareId).lean();
      if (!look) {
        return res.status(404).json({ success: false, message: 'Look share not found.' });
      }
      imageUrl = imageUrl || normalizeImageUrl(look.imageUrl);
      if (!productIds.length) {
        productIds = toObjectIdArray(look.productIds || []);
      }
    }

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'Valid imageUrl is required.' });
    }

    const post = await CommunityPost.create({
      userId,
      lookShareId: lookShareId && mongoose.Types.ObjectId.isValid(lookShareId)
        ? new mongoose.Types.ObjectId(lookShareId)
        : null,
      imageUrl,
      caption: sanitizeCaption(req.body?.caption),
      productIds,
      tags: Array.isArray(req.body?.tags)
        ? req.body.tags.map((tag) => tag?.toString?.().trim?.().toLowerCase() || '').filter(Boolean).slice(0, 12)
        : [],
    });

    return res.status(201).json({
      success: true,
      data: {
        id: post._id?.toString() || '',
        imageUrl: post.imageUrl,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function togglePostLike(req, res, next) {
  try {
    const userId = getAuthUserId(req);
    const id = req.params.id?.toString().trim() || '';
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid post id.' });
    }

    const post = await CommunityPost.findById(id);
    if (!post || post.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const likedBy = Array.isArray(post.likedBy) ? [...post.likedBy] : [];
    const index = likedBy.indexOf(userId);
    let liked = false;
    if (index >= 0) {
      likedBy.splice(index, 1);
      liked = false;
    } else {
      likedBy.push(userId);
      liked = true;
    }

    post.likedBy = likedBy;
    post.likeCount = likedBy.length;
    await post.save();

    return res.status(200).json({
      success: true,
      data: {
        liked,
        likeCount: post.likeCount,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createPost,
  getFeed,
  getInfluencerLook,
  getSharedLook,
  getTrendingLooks,
  shareLook,
  togglePostLike,
  voteSharedLook,
};
