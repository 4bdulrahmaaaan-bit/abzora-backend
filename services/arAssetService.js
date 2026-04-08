const TEMPLATE_BY_CATEGORY = {
  shirt: {
    template: 'shoulder_aligned',
    widthFactor: 1.12,
    heightFactor: 1.58,
    anchors: {
      leftShoulder: { x: 0.32, y: 0.18 },
      rightShoulder: { x: 0.68, y: 0.18 },
      center: { x: 0.5, y: 0.44 },
    },
  },
  tshirt: {
    template: 'torso_template',
    widthFactor: 1.08,
    heightFactor: 1.48,
    anchors: {
      leftShoulder: { x: 0.33, y: 0.2 },
      rightShoulder: { x: 0.67, y: 0.2 },
      center: { x: 0.5, y: 0.45 },
    },
  },
  dress: {
    template: 'full_body_template',
    widthFactor: 1.16,
    heightFactor: 1.9,
    anchors: {
      leftShoulder: { x: 0.34, y: 0.15 },
      rightShoulder: { x: 0.66, y: 0.15 },
      center: { x: 0.5, y: 0.5 },
    },
  },
  top: {
    template: 'torso_template',
    widthFactor: 1.08,
    heightFactor: 1.45,
    anchors: {
      leftShoulder: { x: 0.33, y: 0.19 },
      rightShoulder: { x: 0.67, y: 0.19 },
      center: { x: 0.5, y: 0.44 },
    },
  },
  jacket: {
    template: 'shoulder_aligned',
    widthFactor: 1.18,
    heightFactor: 1.66,
    anchors: {
      leftShoulder: { x: 0.31, y: 0.17 },
      rightShoulder: { x: 0.69, y: 0.17 },
      center: { x: 0.5, y: 0.45 },
    },
  },
};

const DEFAULT_TEMPLATE = {
  template: 'torso_template',
  widthFactor: 1.1,
  heightFactor: 1.52,
  anchors: {
    leftShoulder: { x: 0.33, y: 0.2 },
    rightShoulder: { x: 0.67, y: 0.2 },
    center: { x: 0.5, y: 0.45 },
  },
};

function normalizeCategory(raw = '') {
  const value = raw.toString().trim().toLowerCase();
  if (!value) {
    return 'tshirt';
  }
  if (value.includes('t-shirt') || value.includes('tee')) {
    return 'tshirt';
  }
  if (value.includes('shirt')) {
    return 'shirt';
  }
  if (value.includes('dress') || value.includes('kurti') || value.includes('kurta')) {
    return 'dress';
  }
  if (value.includes('jacket') || value.includes('hoodie') || value.includes('blazer')) {
    return 'jacket';
  }
  if (value.includes('top') || value.includes('blouse')) {
    return 'top';
  }
  return value.replace(/\s+/g, '');
}

function normalizeImageUrl(url = '') {
  return url.toString().trim();
}

function withCloudinaryTransform(url, transform) {
  const normalized = normalizeImageUrl(url);
  if (!normalized || !normalized.includes('/upload/')) {
    return normalized;
  }
  if (normalized.includes(`/upload/${transform}/`)) {
    return normalized;
  }
  return normalized.replace('/upload/', `/upload/${transform}/`);
}

function buildTransparentUrl(sourceImage, transparentImageUrl) {
  if (normalizeImageUrl(transparentImageUrl)) {
    return normalizeImageUrl(transparentImageUrl);
  }
  // Works when Cloudinary background-removal add-on is enabled.
  return withCloudinaryTransform(sourceImage, 'e_background_removal,f_png');
}

function buildNormalizedOverlayUrl(sourceImage) {
  // Standard AR-friendly normalization: centered, transparent background, consistent canvas.
  return withCloudinaryTransform(sourceImage, 'c_pad,ar_3:4,w_1024,h_1365,b_auto:predominant,bo_0px_solid_transparent,f_png');
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function safeAnchors(anchors) {
  return {
    leftShoulder: {
      x: clamp01(anchors?.leftShoulder?.x),
      y: clamp01(anchors?.leftShoulder?.y),
    },
    rightShoulder: {
      x: clamp01(anchors?.rightShoulder?.x),
      y: clamp01(anchors?.rightShoulder?.y),
    },
    center: {
      x: clamp01(anchors?.center?.x),
      y: clamp01(anchors?.center?.y),
    },
  };
}

async function generateArAsset({
  product,
  category,
  imageUrl,
  transparentImageUrl,
} = {}) {
  const sourceImage =
    normalizeImageUrl(imageUrl) ||
    normalizeImageUrl(product?.images?.[0]) ||
    '';
  if (!sourceImage) {
    return {
      status: 'failed',
      category: normalizeCategory(category || product?.category || ''),
      sourceImage: '',
      processedImage: '',
      transparentImage: '',
      fallbackMode: 'static_preview',
      failureReason: 'no_source_image',
      pipelineVersion: 'ar-pipeline-v1',
      generatedAt: new Date(),
    };
  }

  const normalizedCategory = normalizeCategory(category || product?.category || '');
  const template = TEMPLATE_BY_CATEGORY[normalizedCategory] || DEFAULT_TEMPLATE;
  const transparentImage = buildTransparentUrl(sourceImage, transparentImageUrl);
  const processedImage = buildNormalizedOverlayUrl(transparentImage || sourceImage);

  const anchors = safeAnchors(template.anchors);
  const scaleFactor = Math.max(0.75, Math.min(1.7, template.widthFactor));

  const usedFallback =
    !processedImage ||
    !processedImage.includes('/upload/');

  return {
    status: usedFallback ? 'fallback' : 'generated',
    category: normalizedCategory,
    sourceImage,
    transparentImage: transparentImage || sourceImage,
    processedImage: processedImage || sourceImage,
    anchors: {
      left_shoulder: anchors.leftShoulder,
      right_shoulder: anchors.rightShoulder,
      center: anchors.center,
    },
    categoryTemplate: template.template,
    scaleFactor,
    normalization: {
      widthFactor: template.widthFactor,
      heightFactor: template.heightFactor,
      maintainAspectRatio: true,
      centered: true,
      upright: true,
    },
    segmentation: {
      targetRegion: 'torso',
      confidence: usedFallback ? 0.52 : 0.84,
      method: usedFallback ? 'heuristic_fallback' : 'cloudinary_transform_pipeline',
    },
    fallbackMode: usedFallback ? 'static_preview' : '',
    failureReason: '',
    pipelineVersion: 'ar-pipeline-v1',
    generatedAt: new Date(),
  };
}

module.exports = {
  generateArAsset,
  normalizeCategory,
};

