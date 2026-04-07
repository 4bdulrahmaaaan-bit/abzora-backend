const categoryAttributeConfig = {
  shoes: {
    sections: [
      {
        title: 'Material & Build',
        fields: ['upper_material', 'sole_material'],
      },
      {
        title: 'Performance',
        fields: ['closure', 'occasion', 'cushioning', 'fit_type'],
      },
    ],
  },
  clothing: {
    sections: [
      {
        title: 'Product Details',
        fields: ['fabric', 'fit', 'pattern', 'sleeve_type', 'occasion'],
      },
    ],
  },
  watch: {
    sections: [
      {
        title: 'Specifications',
        fields: ['dial_shape', 'strap_material', 'movement', 'water_resistance'],
      },
    ],
  },
  bag: {
    sections: [
      {
        title: 'Product Details',
        fields: ['material', 'capacity', 'closure', 'strap_type'],
      },
    ],
  },
};

const genericFields = ['material', 'usage', 'fit'];

function normalizeCategory(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (['shoe', 'shoes', 'footwear', 'sneakers'].includes(normalized)) {
    return 'shoes';
  }
  if (['clothing', 'apparel', 'fashion', 'dress', 'shirt', 't-shirt', 'kurta'].includes(normalized)) {
    return 'clothing';
  }
  if (['watches'].includes(normalized)) {
    return 'watch';
  }
  if (['bags', 'handbags', 'backpacks'].includes(normalized)) {
    return 'bag';
  }
  return normalized;
}

function allowedFieldsForCategory(category) {
  const normalized = normalizeCategory(category);
  const config = categoryAttributeConfig[normalized];
  if (!config) {
    return new Set(genericFields);
  }
  return new Set(config.sections.flatMap((section) => section.fields));
}

function sanitizeAttributes(category, attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return {};
  }

  const allowedFields = allowedFieldsForCategory(category);
  const sanitized = {};
  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    const key = String(rawKey || '').trim().toLowerCase();
    const value = String(rawValue ?? '').trim();
    if (!key || !value || !allowedFields.has(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

module.exports = {
  categoryAttributeConfig,
  genericFields,
  sanitizeAttributes,
};
