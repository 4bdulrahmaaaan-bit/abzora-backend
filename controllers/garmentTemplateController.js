const mongoose = require('mongoose');

const GarmentTemplate = require('../models/GarmentTemplate');

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

function normalizeStringList(list = []) {
  if (!Array.isArray(list)) {
    return [];
  }
  return [...new Set(list.map((item) => item?.toString().trim()).filter(Boolean))];
}

function normalizeMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key.toString().trim(), entry])
      .filter(([key]) => key)
  );
}

function serializeTemplate(template) {
  const source = typeof template.toObject === 'function' ? template.toObject() : template;
  return {
    id: source._id?.toString() || '',
    slug: source.slug || '',
    name: source.name || '',
    category: source.category || '',
    modelUrls: source.modelUrls || {},
    runtimeProfile: source.runtimeProfile || {},
    rigProfile: source.rigProfile || '',
    blendShapes: source.blendShapes ? Object.fromEntries(Object.entries(source.blendShapes)) : {},
    customizableParts: source.customizableParts
      ? Object.fromEntries(Object.entries(source.customizableParts))
      : {},
    supportedFits: Array.isArray(source.supportedFits) ? source.supportedFits : [],
    defaultMaterialProfile: source.defaultMaterialProfile || '',
    defaultColorHex: source.defaultColorHex || '#C6A769',
    defaultFabricTextureUrl: source.defaultFabricTextureUrl || '',
    cachePolicy: source.cachePolicy || {},
    active: source.active !== false,
    updatedAt: source.updatedAt || null,
  };
}

async function listGarmentTemplates(req, res, next) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const category = req.query.category?.toString().trim() || '';
    const query = {};
    if (!includeInactive) {
      query.active = true;
    }
    if (category) {
      query.category = category;
    }
    const templates = await GarmentTemplate.find(query).sort({ category: 1, slug: 1 });
    return res.status(200).json({
      success: true,
      data: templates.map(serializeTemplate),
    });
  } catch (error) {
    return next(error);
  }
}

async function getGarmentTemplate(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid template id.' });
    }
    const template = await GarmentTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }
    return res.status(200).json({
      success: true,
      data: serializeTemplate(template),
    });
  } catch (error) {
    return next(error);
  }
}

async function upsertGarmentTemplate(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const {
      id,
      slug,
      name,
      category,
      modelUrls,
      runtimeProfile,
      rigProfile,
      blendShapes,
      customizableParts,
      supportedFits,
      defaultMaterialProfile,
      defaultColorHex,
      defaultFabricTextureUrl,
      cachePolicy,
      active,
    } = req.body || {};

    const normalizedSlug = slug?.toString().trim().toLowerCase() || '';
    const normalizedName = name?.toString().trim() || '';
    const normalizedCategory = category?.toString().trim().toLowerCase() || '';
    if (!normalizedSlug || !normalizedName || !normalizedCategory) {
      return res.status(400).json({
        success: false,
        message: 'slug, name and category are required.',
      });
    }

    const payload = {
      slug: normalizedSlug,
      name: normalizedName,
      category: normalizedCategory,
      modelUrls: {
        lod0: normalizeOptionalUrl(modelUrls?.lod0),
        lod1: normalizeOptionalUrl(modelUrls?.lod1),
        lod2: normalizeOptionalUrl(modelUrls?.lod2),
        preview: normalizeOptionalUrl(modelUrls?.preview),
      },
      runtimeProfile: {
        assetBundleUrl: normalizeOptionalUrl(runtimeProfile?.assetBundleUrl),
        sceneKey: runtimeProfile?.sceneKey?.toString().trim() || '',
      },
      rigProfile: rigProfile?.toString().trim() || '',
      blendShapes: normalizeMap(blendShapes),
      customizableParts: normalizeMap(customizableParts),
      supportedFits: normalizeStringList(supportedFits),
      defaultMaterialProfile: defaultMaterialProfile?.toString().trim() || '',
      defaultColorHex: defaultColorHex?.toString().trim() || '#C6A769',
      defaultFabricTextureUrl: normalizeOptionalUrl(defaultFabricTextureUrl),
      cachePolicy: {
        preload: cachePolicy?.preload !== false,
        ttlSeconds: Number(cachePolicy?.ttlSeconds) > 60
          ? Math.floor(Number(cachePolicy.ttlSeconds))
          : 86400,
      },
      active: active !== false,
    };

    let template;
    if (id && mongoose.Types.ObjectId.isValid(id)) {
      template = await GarmentTemplate.findByIdAndUpdate(id, payload, {
        new: true,
        runValidators: true,
      });
      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }
    } else {
      template = await GarmentTemplate.findOneAndUpdate(
        { slug: normalizedSlug },
        payload,
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
    }

    return res.status(200).json({
      success: true,
      data: serializeTemplate(template),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Template slug already exists.' });
    }
    return next(error);
  }
}

module.exports = {
  getGarmentTemplate,
  listGarmentTemplates,
  upsertGarmentTemplate,
};
