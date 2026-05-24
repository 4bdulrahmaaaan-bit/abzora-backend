const mongoose = require('mongoose');

const Product = require('../models/Product');
const Store = require('../models/Store');
const TryOnSession = require('../models/TryOnSession');
const GarmentTemplate = require('../models/GarmentTemplate');
const FitProfile = require('../models/FitProfile');
const ArTryOnLook = require('../models/ArTryOnLook');
const { generateArAsset } = require('../services/arAssetService');
const { evaluateFit } = require('../services/garmentFitEngineService');
const cache = require('../services/redisCacheService');

const ALLOWED_TRYON_STATUSES = new Set(['active', 'completed', 'abandoned']);

function tryOnProductCacheKey(id) {
  return `ar:product:${id}`;
}

function fitScoreCacheKey({
  productId = '',
  templateId = '',
  category = '',
  fitPreset = '',
  userMeasurements = {},
}) {
  const signature = JSON.stringify({
    productId,
    templateId,
    category,
    fitPreset,
    userMeasurements,
  });
  return `ar:fit:${signature}`;
}

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

function normalizeOptionalUrl(value) {
  const normalized = value?.toString().trim() || '';
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch (_) {
    return '';
  }
}

function clampNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, numeric));
}

function ensureArAsset(product) {
  const source = typeof product.toObject === 'function' ? product.toObject() : product;
  const arAsset =
    source.arAsset && typeof source.arAsset === 'object' && !Array.isArray(source.arAsset)
      ? source.arAsset
      : {};
  if (arAsset.processedImage || arAsset.transparentImage) {
    return arAsset;
  }
  const fallbackImage = Array.isArray(source.images) ? source.images[0] || '' : '';
  return {
    ...arAsset,
    processedImage: fallbackImage,
    transparentImage: fallbackImage,
    categoryTemplate: arAsset.categoryTemplate || 'torso_template',
    scaleFactor: Number(arAsset.scaleFactor || 1),
    normalization: {
      widthFactor: Number(arAsset?.normalization?.widthFactor || 1),
      heightFactor: Number(arAsset?.normalization?.heightFactor || 1),
      maintainAspectRatio: true,
      centered: true,
      upright: true,
    },
    anchors: {
      left_shoulder: {
        x: Number(arAsset?.anchors?.left_shoulder?.x || 0.32),
        y: Number(arAsset?.anchors?.left_shoulder?.y || 0.18),
      },
      right_shoulder: {
        x: Number(arAsset?.anchors?.right_shoulder?.x || 0.68),
        y: Number(arAsset?.anchors?.right_shoulder?.y || 0.18),
      },
      center: {
        x: Number(arAsset?.anchors?.center?.x || 0.5),
        y: Number(arAsset?.anchors?.center?.y || 0.44),
      },
    },
    fallbackMode: arAsset.fallbackMode || 'static_preview',
  };
}

function serializeTryOnProduct(product, store) {
  const source = typeof product.toObject === 'function' ? product.toObject() : product;
  const arAsset = ensureArAsset(source);
  const templateSource =
    source.garmentConfig?.templateId &&
    typeof source.garmentConfig.templateId === 'object' &&
    !Array.isArray(source.garmentConfig.templateId)
      ? source.garmentConfig.templateId
      : null;
  const garmentConfigSource =
    source.garmentConfig && typeof source.garmentConfig === 'object'
      ? source.garmentConfig
      : {};
  const fitPreset = (garmentConfigSource.fitPreset || 'regular').toString();
  const lodModels = templateSource?.modelUrls
    ? {
        lod0: templateSource.modelUrls?.lod0 || source.model3d || '',
        lod1: templateSource.modelUrls?.lod1 || '',
        lod2: templateSource.modelUrls?.lod2 || '',
      }
    : {
        lod0: source.model3d || '',
        lod1: '',
        lod2: '',
      };
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
  const fitRecommendation = evaluateFit({
    category: source.category || templateSource?.category || 'shirt',
    fitPreset: fitPreset,
    userMeasurements: {},
  });

  return {
    id: source._id?.toString() || source.id || '',
    name: source.name || '',
    category: source.category || '',
    subcategory: source.subcategory || '',
    images: Array.isArray(source.images) ? source.images : [],
    model3d: source.model3d || templateSource?.modelUrls?.lod0 || '',
    assetBundleUrl:
      source.assetBundleUrl ||
      templateSource?.runtimeProfile?.assetBundleUrl ||
      templateSource?.assetBundleUrl ||
      '',
    rigProfile: source.rigProfile || templateSource?.rigProfile || '',
    materialProfile:
      source.materialProfile || templateSource?.defaultMaterialProfile || '',
    overlayAssetUrl: arAsset.processedImage || arAsset.transparentImage || source.images?.[0] || '',
    transparentAssetUrl: arAsset.transparentImage || '',
    templateId:
      garmentConfigSource.templateId?.toString?.() ||
      garmentConfigSource.templateId ||
      templateSource?._id?.toString() ||
      '',
    template: templateSource
      ? {
          id: templateSource._id?.toString() || '',
          slug: templateSource.slug || '',
          name: templateSource.name || '',
          category: templateSource.category || '',
          customizableParts:
            templateSource.customizableParts &&
            typeof templateSource.customizableParts === 'object'
              ? Object.fromEntries(Object.entries(templateSource.customizableParts))
              : {},
          blendShapes:
            templateSource.blendShapes && typeof templateSource.blendShapes === 'object'
              ? Object.fromEntries(Object.entries(templateSource.blendShapes))
              : {},
          supportedFits: Array.isArray(templateSource.supportedFits)
            ? templateSource.supportedFits
            : [],
        }
      : null,
    garmentConfig: {
      templateId:
        garmentConfigSource.templateId?.toString?.() ||
        garmentConfigSource.templateId ||
        '',
      fabricTextureUrl: garmentConfigSource.fabricTextureUrl || '',
      fit: fitPreset,
      color: garmentConfigSource.colorHex || templateSource?.defaultColorHex || '#C6A769',
      designOptions:
        garmentConfigSource.designOptions &&
        typeof garmentConfigSource.designOptions === 'object'
          ? Object.fromEntries(Object.entries(garmentConfigSource.designOptions))
          : {},
      blendShapeOverrides:
        garmentConfigSource.blendShapeOverrides &&
        typeof garmentConfigSource.blendShapeOverrides === 'object'
          ? Object.fromEntries(Object.entries(garmentConfigSource.blendShapeOverrides))
          : {},
      lodPreference: garmentConfigSource.lodPreference || 'auto',
      lodModels,
    },
    fitRecommendation: {
      recommendedSize: fitRecommendation.recommendedSize,
      fitScore: fitRecommendation.fitScore,
      fitLabel: fitRecommendation.fitLabel,
      confidence: fitRecommendation.confidence,
    },
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

    const cached = await cache.getJson(tryOnProductCacheKey(id));
    if (cached && typeof cached === 'object') {
      return res.status(200).json({ success: true, data: cached });
    }

    const product = await Product.findById(id)
      .populate('storeId', 'name rating logoUrl')
      .populate('garmentConfig.templateId');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const serialized = serializeTryOnProduct(product, product.storeId);
    await cache.setJson(tryOnProductCacheKey(id), serialized, 180);

    return res.status(200).json({
      success: true,
      data: serialized,
    });
  } catch (error) {
    return next(error);
  }
}

async function getTryOnGarmentManifest(req, res, next) {
  try {
    const rawIds = req.query?.ids?.toString() || '';
    const ids = rawIds
      .split(',')
      .map((item) => item.trim())
      .filter((item) => mongoose.Types.ObjectId.isValid(item));
    if (!ids.length) {
      return res.status(400).json({
        success: false,
        message: 'ids query param is required (comma separated product ids).',
      });
    }

    const products = await Product.find({ _id: { $in: ids } })
      .populate('storeId', 'name rating logoUrl')
      .populate('garmentConfig.templateId')
      .lean();
    const byId = new Map(products.map((product) => [product._id.toString(), product]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((product) => serializeTryOnProduct(product, product.storeId));

    return res.status(200).json({
      success: true,
      data: ordered,
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
      captureCount: clampNumber(captureCount, 0, 0, 10000),
      outfitSwitchCount: clampNumber(outfitSwitchCount, 0, 0, 10000),
      averageFps: clampNumber(averageFps, 0, 0, 240),
      peakFps: clampNumber(peakFps, 0, 0, 240),
      averagePoseConfidence: clampNumber(averagePoseConfidence, 0, 0, 1),
      bodyProfileSnapshot: sanitizeNumberMap(bodyProfileSnapshot),
      measurements: sanitizeNumberMap(measurements),
      renderStats: {
        renderer: renderStats?.renderer?.toString().trim() || 'hybrid_2d',
        occlusionEnabled: Boolean(renderStats?.occlusionEnabled),
        physicsEnabled: Boolean(renderStats?.physicsEnabled),
        frameSkipCount: clampNumber(renderStats?.frameSkipCount, 0, 0, 100000),
      },
      events: Array.isArray(events)
        ? events.slice(-120).map((event) => ({
            timestampMs: clampNumber(event?.timestampMs, 0, 0, 86400000),
            fps: clampNumber(event?.fps, 0, 0, 240),
            poseConfidence: clampNumber(event?.poseConfidence, 0, 0, 1),
            bodyVisible: Boolean(event?.bodyVisible),
            lightingScore: clampNumber(event?.lightingScore, 0, 0, 1),
          }))
        : [],
      previewImageUrl: normalizeOptionalUrl(previewImageUrl),
      status: ALLOWED_TRYON_STATUSES.has(status?.toString().trim())
        ? status.toString().trim()
        : 'active',
    };

    const session = await TryOnSession.findOneAndUpdate(
      { userId: req.user.uid, sessionId: normalizedSessionId },
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
      return res.status(409).json({ success: false, message: 'Try-on session already exists for this user.' });
    }
    return next(error);
  }
}

async function getFitAssessment(req, res, next) {
  try {
    const {
      productId,
      templateId,
      category,
      fitPreset,
      userMeasurements,
      sizeChart,
    } = req.body || {};

    let resolvedCategory = category?.toString().trim().toLowerCase() || '';
    let resolvedFitPreset = fitPreset?.toString().trim().toLowerCase() || '';
    let templateSummary = null;

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      const product = await Product.findById(productId)
        .select('category garmentConfig')
        .populate('garmentConfig.templateId');
      if (!product) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }
      resolvedCategory = resolvedCategory || product.category?.toString().trim().toLowerCase() || 'shirt';
      resolvedFitPreset =
        resolvedFitPreset ||
        product.garmentConfig?.fitPreset?.toString().trim().toLowerCase() ||
        'regular';
      const template = product.garmentConfig?.templateId;
      if (template && typeof template === 'object') {
        templateSummary = {
          id: template._id?.toString() || '',
          slug: template.slug || '',
          name: template.name || '',
          category: template.category || '',
          supportedFits: Array.isArray(template.supportedFits) ? template.supportedFits : [],
        };
      }
    } else if (templateId && mongoose.Types.ObjectId.isValid(templateId)) {
      const template = await GarmentTemplate.findById(templateId);
      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }
      resolvedCategory = resolvedCategory || template.category || 'shirt';
      templateSummary = {
        id: template._id?.toString() || '',
        slug: template.slug || '',
        name: template.name || '',
        category: template.category || '',
        supportedFits: Array.isArray(template.supportedFits) ? template.supportedFits : [],
      };
    }

    if (!resolvedCategory) {
      resolvedCategory = 'shirt';
    }
    if (!resolvedFitPreset) {
      resolvedFitPreset = 'regular';
    }

    const cacheKey = fitScoreCacheKey({
      productId: productId?.toString() || '',
      templateId: templateId?.toString() || '',
      category: resolvedCategory,
      fitPreset: resolvedFitPreset,
      userMeasurements: sanitizeNumberMap(userMeasurements),
    });
    const cached = await cache.getJson(cacheKey);
    if (cached && typeof cached === 'object') {
      return res.status(200).json({ success: true, data: cached });
    }

    const assessment = evaluateFit({
      category: resolvedCategory,
      fitPreset: resolvedFitPreset,
      userMeasurements,
      sizeChart,
    });

    const responsePayload = {
      productId: productId?.toString() || '',
      templateId: templateSummary?.id || templateId?.toString() || '',
      category: resolvedCategory,
      fitPreset: resolvedFitPreset,
      recommendedSize: assessment.recommendedSize,
      fitScore: assessment.fitScore,
      fitLabel: assessment.fitLabel,
      confidence: assessment.confidence,
      usedMeasurements: assessment.usedMeasurements,
      sizeChart: assessment.effectiveSizeChart,
      template: templateSummary,
    };

    await cache.setJson(cacheKey, responsePayload, 120);

    if (req.user?.uid && productId && mongoose.Types.ObjectId.isValid(productId)) {
      await FitProfile.findOneAndUpdate(
        {
          userId: req.user.uid,
          productId: new mongoose.Types.ObjectId(productId),
        },
        {
          userId: req.user.uid,
          productId: new mongoose.Types.ObjectId(productId),
          templateId: responsePayload.templateId && mongoose.Types.ObjectId.isValid(responsePayload.templateId)
            ? new mongoose.Types.ObjectId(responsePayload.templateId)
            : null,
          measurements: sanitizeNumberMap(userMeasurements),
          recommendedSize: responsePayload.recommendedSize,
          fitScore: responsePayload.fitScore,
          fitLabel: responsePayload.fitLabel,
          confidence: responsePayload.confidence,
          source: 'live_tryon',
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );
    }

    return res.status(200).json({
      success: true,
      data: responsePayload,
    });
  } catch (error) {
    return next(error);
  }
}

async function saveTryOnLook(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      productId,
      templateId,
      imageUrl,
      size,
      fitScore,
      confidence,
      source,
    } = req.body || {};

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }
    if (!imageUrl || !normalizeOptionalUrl(imageUrl)) {
      return res.status(400).json({ success: false, message: 'Valid imageUrl is required.' });
    }

    const look = await ArTryOnLook.create({
      userId: req.user.uid,
      productId: new mongoose.Types.ObjectId(productId),
      templateId:
        templateId && mongoose.Types.ObjectId.isValid(templateId)
          ? new mongoose.Types.ObjectId(templateId)
          : null,
      imageUrl: normalizeOptionalUrl(imageUrl),
      size: size?.toString().trim() || '',
      fitScore: clampNumber(fitScore, 0, 0, 100),
      confidence: clampNumber(confidence, 0, 0, 1),
      source: source?.toString().trim() || 'ar_live',
    });

    return res.status(201).json({
      success: true,
      data: {
        id: look._id?.toString() || '',
        imageUrl: look.imageUrl,
        productId: look.productId?.toString() || '',
        templateId: look.templateId?.toString() || '',
        fitScore: Number(look.fitScore || 0),
        confidence: Number(look.confidence || 0),
        createdAt: look.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function saveTryOnTelemetry(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { productId, sessionId, telemetry } = req.body || {};
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid productId is required.' });
    }
    const normalizedSessionId = sessionId?.toString().trim() || '';
    if (!normalizedSessionId) {
      return res.status(400).json({ success: false, message: 'sessionId is required.' });
    }

    const safeTelemetry = {
      trackingReliability: clampNumber(telemetry?.trackingReliability, 0, 0, 1),
      motionQuality: clampNumber(telemetry?.motionQuality, 0, 0, 1),
      segmentationConfidence: clampNumber(telemetry?.segmentationConfidence, 0, 0, 1),
      thermalLoad: clampNumber(telemetry?.thermalLoad, 0, 0, 1),
      sessionQuality: clampNumber(telemetry?.sessionQuality, 0, 0, 1),
      fps: clampNumber(telemetry?.fps, 0, 0, 240),
      renderQuality: clampNumber(telemetry?.renderQuality, 0, 0, 1),
    };
    const dashboard =
      telemetry?.dashboard && typeof telemetry.dashboard === 'object'
        ? telemetry.dashboard
        : {};

    const updated = await TryOnSession.findOneAndUpdate(
      {
        userId: req.user.uid,
        productId: new mongoose.Types.ObjectId(productId),
        sessionId: normalizedSessionId,
      },
      {
        $set: {
          telemetry: safeTelemetry,
          telemetryDashboard: dashboard,
        },
      },
      {
        new: true,
      }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Try-on session not found. Save session before telemetry.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: updated._id?.toString() || '',
        sessionId: updated.sessionId,
        telemetry: safeTelemetry,
        telemetryDashboard: updated.telemetryDashboard || {},
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getTryOnTelemetrySummary(req, res, next) {
  try {
    const days = clampNumber(req.query?.days, 7, 1, 30);
    const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const sessions = await TryOnSession.find({
      updatedAt: { $gte: since },
    }).select('telemetry telemetryDashboard updatedAt');

    const total = sessions.length;
    if (!total) {
      return res.status(200).json({
        success: true,
        data: {
          days,
          totalSessions: 0,
          averages: {},
          rates: {},
          bands: {},
          flags: {},
        },
      });
    }

    const sum = {
      sessionQuality: 0,
      trackingReliability: 0,
      segmentationConfidence: 0,
      thermalLoad: 0,
      renderQuality: 0,
      fps: 0,
    };
    const rates = {
      thermalRiskRate: 0,
      trackingRiskRate: 0,
      segmentationRiskRate: 0,
      poseLatencyRiskRate: 0,
      poseErrorRiskRate: 0,
      sustainedLiteModeRate: 0,
    };
    const bands = {
      qualityBand: {},
      thermalBand: {},
      trackingBand: {},
      segmentationBand: {},
    };
    const deviceTierBreakdown = {};
    const dailyMap = new Map();

    for (const session of sessions) {
      const telemetry = session.telemetry || {};
      sum.sessionQuality += Number(telemetry.sessionQuality || 0);
      sum.trackingReliability += Number(telemetry.trackingReliability || 0);
      sum.segmentationConfidence += Number(telemetry.segmentationConfidence || 0);
      sum.thermalLoad += Number(telemetry.thermalLoad || 0);
      sum.renderQuality += Number(telemetry.renderQuality || 0);
      sum.fps += Number(telemetry.fps || 0);

      const dash = session.telemetryDashboard || {};
      const flags = dash.flags && typeof dash.flags === 'object' ? dash.flags : {};
      if (flags.thermalRisk === true) rates.thermalRiskRate += 1;
      if (flags.trackingRisk === true) rates.trackingRiskRate += 1;
      if (flags.segmentationRisk === true) rates.segmentationRiskRate += 1;
      if (flags.poseLatencyRisk === true) rates.poseLatencyRiskRate += 1;
      if (flags.poseErrorRisk === true) rates.poseErrorRiskRate += 1;
      if (flags.sustainedLiteMode === true) rates.sustainedLiteModeRate += 1;

      ['qualityBand', 'thermalBand', 'trackingBand', 'segmentationBand'].forEach((key) => {
        const value = dash[key]?.toString() || '';
        if (!value) return;
        bands[key][value] = Number(bands[key][value] || 0) + 1;
      });

      const tier = dash.deviceTier?.toString() || 'unknown';
      if (!deviceTierBreakdown[tier]) {
        deviceTierBreakdown[tier] = {
          sessions: 0,
          sessionQualitySum: 0,
          thermalLoadSum: 0,
          trackingReliabilitySum: 0,
          thermalRiskCount: 0,
          trackingRiskCount: 0,
        };
      }
      deviceTierBreakdown[tier].sessions += 1;
      deviceTierBreakdown[tier].sessionQualitySum += Number(telemetry.sessionQuality || 0);
      deviceTierBreakdown[tier].thermalLoadSum += Number(telemetry.thermalLoad || 0);
      deviceTierBreakdown[tier].trackingReliabilitySum += Number(telemetry.trackingReliability || 0);
      const tierFlags = dash.flags && typeof dash.flags === 'object' ? dash.flags : {};
      if (tierFlags.thermalRisk === true) {
        deviceTierBreakdown[tier].thermalRiskCount += 1;
      }
      if (tierFlags.trackingRisk === true) {
        deviceTierBreakdown[tier].trackingRiskCount += 1;
      }

      const dayKey = new Date(session.updatedAt || Date.now()).toISOString().slice(0, 10);
      const bucket = dailyMap.get(dayKey) || {
        day: dayKey,
        sessions: 0,
        sessionQualitySum: 0,
        thermalLoadSum: 0,
        trackingReliabilitySum: 0,
      };
      bucket.sessions += 1;
      bucket.sessionQualitySum += Number(telemetry.sessionQuality || 0);
      bucket.thermalLoadSum += Number(telemetry.thermalLoad || 0);
      bucket.trackingReliabilitySum += Number(telemetry.trackingReliability || 0);
      dailyMap.set(dayKey, bucket);
    }

    const safeDiv = (value) => Number((value / total).toFixed(4));
    const average = (value) => Number((value / total).toFixed(4));

    const daily = [...dailyMap.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((bucket) => ({
        day: bucket.day,
        sessions: bucket.sessions,
        avgSessionQuality: Number((bucket.sessionQualitySum / bucket.sessions).toFixed(4)),
        avgThermalLoad: Number((bucket.thermalLoadSum / bucket.sessions).toFixed(4)),
        avgTrackingReliability: Number(
          (bucket.trackingReliabilitySum / bucket.sessions).toFixed(4)
        ),
      }));

    const deviceTiers = Object.entries(deviceTierBreakdown).reduce((acc, [tier, value]) => {
      const sessions = Number(value.sessions || 0);
      if (!sessions) {
        return acc;
      }
      acc[tier] = {
        sessions,
        avgSessionQuality: Number((value.sessionQualitySum / sessions).toFixed(4)),
        avgThermalLoad: Number((value.thermalLoadSum / sessions).toFixed(4)),
        avgTrackingReliability: Number((value.trackingReliabilitySum / sessions).toFixed(4)),
        thermalRiskRate: Number((value.thermalRiskCount / sessions).toFixed(4)),
        trackingRiskRate: Number((value.trackingRiskCount / sessions).toFixed(4)),
      };
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      data: {
        days,
        totalSessions: total,
        averages: {
          sessionQuality: average(sum.sessionQuality),
          trackingReliability: average(sum.trackingReliability),
          segmentationConfidence: average(sum.segmentationConfidence),
          thermalLoad: average(sum.thermalLoad),
          renderQuality: average(sum.renderQuality),
          fps: average(sum.fps),
        },
        rates: {
          thermalRiskRate: safeDiv(rates.thermalRiskRate),
          trackingRiskRate: safeDiv(rates.trackingRiskRate),
          segmentationRiskRate: safeDiv(rates.segmentationRiskRate),
          poseLatencyRiskRate: safeDiv(rates.poseLatencyRiskRate),
          poseErrorRiskRate: safeDiv(rates.poseErrorRiskRate),
          sustainedLiteModeRate: safeDiv(rates.sustainedLiteModeRate),
        },
        bands,
        daily,
        deviceTiers,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createTryOnSession,
  getFitAssessment,
  saveTryOnLook,
  saveTryOnTelemetry,
  getTryOnTelemetrySummary,
  getTryOnProduct,
  getTryOnGarmentManifest,
};

