const mongoose = require('mongoose');

const Product = require('../models/Product');
const Store = require('../models/Store');
const TryOnSession = require('../models/TryOnSession');
const { generateArAsset } = require('../services/arAssetService');

function serializeStore(store) {
  if (!store) {
    return null;
  }
  return {
    id: store._id?.toString() || '',
    name: store.name || '',
    rating: Number(store.rating || 0),
    logoUrl: store.logoUrl || '',
  };
}

function sanitizeNumberMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key.toString(), Number(value)])
      .filter(([, value]) => Number.isFinite(value))
  );
}

function serializeTryOnProduct(product, store) {
  const source = typeof product.toObject === 'function' ? product.toObject() : product;
  const arAsset = source.arAsset && typeof source.arAsset === 'object' ? source.arAsset : {};
  const alignmentConfig = {
    anchorTemplate: arAsset.categoryTemplate || 'torso_template',
    scaleFactor: Number(arAsset.scaleFactor || 1),
    widthFactor: Number(arAsset?.normalization?.widthFactor || 1),
    heightFactor: Number(arAsset?.normalization?.heightFactor || 1),
    fallbackMode: arAsset.fallbackMode || '',
    processedImage: arAsset.processedImage || '',
    transparentImage: arAsset.transparentImage || '',
    anchors: {
      leftShoulder: {
        x: Number(arAsset?.anchors?.left_shoulder?.x || 0),
        y: Number(arAsset?.anchors?.left_shoulder?.y || 0),
      },
      rightShoulder: {
        x: Number(arAsset?.anchors?.right_shoulder?.x || 0),
        y: Number(arAsset?.anchors?.right_shoulder?.y || 0),
      },
      center: {
        x: Number(arAsset?.anchors?.center?.x || 0),
        y: Number(arAsset?.anchors?.center?.y || 0),
      },
    },
  };

  return {
    id: source._id?.toString() || source.id || '',
    name: source.name || '',
    category: source.category || '',
    subcategory: source.subcategory || '',
    images: Array.isArray(source.images) ? source.images : [],
    model3d: source.model3d || '',
    unityAssetBundleUrl: source.unityAssetBundleUrl || '',
    rigProfile: source.rigProfile || '',
    materialProfile: source.materialProfile || '',
    overlayAssetUrl: arAsset.processedImage || arAsset.transparentImage || source.images?.[0] || '',
    transparentAssetUrl: arAsset.transparentImage || '',
    alignmentConfig,
    arAsset,
    store: serializeStore(store),
    updatedAt: source.updatedAt || null,
  };
}

async function getTryOnProduct(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product id.' });
    }

    const product = await Product.findById(id).populate('storeId', 'name rating logoUrl');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    if (!product.arAsset || !product.arAsset.processedImage) {
      product.arAsset = await generateArAsset({ product });
      await product.save();
    }

    return res.status(200).json({
      success: true,
      data: serializeTryOnProduct(product, product.storeId),
    });
  } catch (error) {
    return next(error);
  }
}

async function createTryOnSession(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      productId,
      sessionId,
      platform,
      deviceModel,
      cameraFacing,
      mode,
      captureCount,
      outfitSwitchCount,
      averageFps,
      peakFps,
      averagePoseConfidence,
      bodyProfileSnapshot,
      measurements,
      renderStats,
      events,
      previewImageUrl,
      status,
    } = req.body || {};

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }

    const normalizedSessionId = sessionId?.toString().trim() || '';
    if (!normalizedSessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required.' });
    }

    const product = await Product.findById(productId).select('_id storeId');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const payload = {
      userId: req.user.uid,
      productId: product._id,
      storeId: product.storeId || null,
      sessionId: normalizedSessionId,
      platform: platform?.toString().trim() || '',
      deviceModel: deviceModel?.toString().trim() || '',
      cameraFacing: cameraFacing?.toString().trim() || 'front',
      mode: mode?.toString().trim() || 'live_overlay',
      captureCount: Math.max(0, Number(captureCount || 0)),
      outfitSwitchCount: Math.max(0, Number(outfitSwitchCount || 0)),
      averageFps: Number(averageFps || 0),
      peakFps: Number(peakFps || 0),
      averagePoseConfidence: Number(averagePoseConfidence || 0),
      bodyProfileSnapshot: sanitizeNumberMap(bodyProfileSnapshot),
      measurements: sanitizeNumberMap(measurements),
      renderStats: {
        renderer: renderStats?.renderer?.toString().trim() || 'hybrid_2d',
        occlusionEnabled: Boolean(renderStats?.occlusionEnabled),
        physicsEnabled: Boolean(renderStats?.physicsEnabled),
        frameSkipCount: Math.max(0, Number(renderStats?.frameSkipCount || 0)),
      },
      events: Array.isArray(events)
        ? events.slice(-120).map((event) => ({
            timestampMs: Number(event?.timestampMs || 0),
            fps: Number(event?.fps || 0),
            poseConfidence: Number(event?.poseConfidence || 0),
            bodyVisible: Boolean(event?.bodyVisible),
            lightingScore: Number(event?.lightingScore || 0),
          }))
        : [],
      previewImageUrl: previewImageUrl?.toString().trim() || '',
      status: status?.toString().trim() || 'active',
    };

    const session = await TryOnSession.findOneAndUpdate(
      { sessionId: normalizedSessionId },
      payload,
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        id: session._id?.toString() || '',
        sessionId: session.sessionId,
        productId: session.productId?.toString() || '',
        status: session.status,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Try-on session already exists.' });
    }
    return next(error);
  }
}

module.exports = {
  createTryOnSession,
  getTryOnProduct,
};
