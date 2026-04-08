const CATEGORY_SPEC_CONFIG = {
  clothing: {
    sections: [
      {
        title: 'Product Details',
        fields: ['fabric', 'fit', 'pattern', 'sleeve_type', 'occasion'],
      },
      {
        title: 'Fit & Comfort',
        fields: ['neck_type', 'length', 'stretch', 'care'],
      },
    ],
  },
  footwear: {
    sections: [
      {
        title: 'Material & Build',
        fields: ['upper_material', 'sole_material', 'closure'],
      },
      {
        title: 'Performance',
        fields: ['purpose', 'cushioning', 'fit_type', 'traction'],
      },
    ],
  },
  accessories: {
    sections: [
      {
        title: 'Product Details',
        fields: ['material', 'closure', 'capacity', 'strap_type'],
      },
      {
        title: 'Usage',
        fields: ['occasion', 'compartments', 'care'],
      },
    ],
  },
  beauty: {
    sections: [
      {
        title: 'Specifications',
        fields: ['skin_type', 'finish', 'coverage', 'ingredients'],
      },
      {
        title: 'How To Use',
        fields: ['usage', 'benefits', 'care'],
      },
    ],
  },
  generic: {
    sections: [
      {
        title: 'Product Details',
        fields: ['material', 'fit', 'usage'],
      },
    ],
  },
};

const FIELD_LABELS = {
  upper_material: 'Upper Material',
  sole_material: 'Sole Material',
  closure: 'Closure',
  purpose: 'Purpose',
  cushioning: 'Cushioning',
  fit_type: 'Fit Type',
  traction: 'Traction',
  fabric: 'Fabric',
  fit: 'Fit',
  pattern: 'Pattern',
  sleeve_type: 'Sleeve Type',
  occasion: 'Occasion',
  neck_type: 'Neck Type',
  length: 'Length',
  stretch: 'Stretch',
  care: 'Care Instructions',
  material: 'Material',
  capacity: 'Capacity',
  strap_type: 'Strap Type',
  compartments: 'Compartments',
  skin_type: 'Skin Type',
  finish: 'Finish',
  coverage: 'Coverage',
  ingredients: 'Ingredients',
  usage: 'Usage',
  benefits: 'Benefits',
};

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeCategory(category, subcategory = '') {
  const text = `${normalizeText(category)} ${normalizeText(subcategory)}`.toLowerCase();
  if (!text) return 'generic';
  if (
    text.includes('shoe') ||
    text.includes('sneaker') ||
    text.includes('boot') ||
    text.includes('footwear') ||
    text.includes('sandal')
  ) {
    return 'footwear';
  }
  if (
    text.includes('shirt') ||
    text.includes('jean') ||
    text.includes('dress') ||
    text.includes('clothing') ||
    text.includes('top') ||
    text.includes('pant') ||
    text.includes('jacket')
  ) {
    return 'clothing';
  }
  if (
    text.includes('bag') ||
    text.includes('watch') ||
    text.includes('wallet') ||
    text.includes('belt') ||
    text.includes('accessor')
  ) {
    return 'accessories';
  }
  if (
    text.includes('beauty') ||
    text.includes('serum') ||
    text.includes('makeup') ||
    text.includes('cream') ||
    text.includes('lipstick')
  ) {
    return 'beauty';
  }
  return 'generic';
}

function valueFromDescription({ field, description, name }) {
  const text = `${normalizeText(description)} ${normalizeText(name)}`.toLowerCase();
  if (!text) return '';
  if (field === 'fabric' && text.includes('cotton')) return 'Cotton';
  if (field === 'fabric' && text.includes('linen')) return 'Linen';
  if (field === 'upper_material' && text.includes('mesh')) return 'Mesh';
  if (field === 'upper_material' && text.includes('leather')) return 'Leather';
  if (field === 'sole_material' && text.includes('rubber')) return 'Rubber';
  if (field === 'closure' && text.includes('lace')) return 'Lace-up';
  if (field === 'closure' && text.includes('slip')) return 'Slip-on';
  if (field === 'fit' || field === 'fit_type') {
    if (text.includes('slim')) return 'Slim';
    if (text.includes('regular')) return 'Regular';
    if (text.includes('loose') || text.includes('relaxed')) return 'Relaxed';
  }
  if (field === 'occasion') {
    if (text.includes('run')) return 'Sport';
    if (text.includes('party')) return 'Party';
    if (text.includes('formal')) return 'Formal';
    if (text.includes('casual')) return 'Casual';
  }
  if (field === 'purpose' && text.includes('run')) return 'Running';
  if (field === 'cushioning' && text.includes('cushion')) return 'High';
  return '';
}

function sanitizeAttributes(raw = {}) {
  const output = {};
  if (!raw || typeof raw !== 'object') {
    return output;
  }
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeText(key).toLowerCase();
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) continue;
    output[normalizedKey] = normalizedValue;
  }
  return output;
}

function cleanDescription(description) {
  return normalizeText(description).replace(/\s+/g, ' ');
}

function buildDescriptionBundle({ name, brand, category, subcategory, description }) {
  const clean = cleanDescription(description);
  const identity = [normalizeText(brand), normalizeText(name)].filter(Boolean).join(' ');
  const context = [normalizeText(category), normalizeText(subcategory)]
    .filter(Boolean)
    .join(' • ');
  const shortDescription =
    clean || `${identity || 'This product'} delivers premium quality with dependable everyday comfort.`;
  const longDescription = `${shortDescription}${context ? ` Designed for ${context.toLowerCase()}.` : ''} Crafted for comfort, style, and reliable daily use.`;
  const structured = {
    highlight: shortDescription.split('.').filter(Boolean)[0] || shortDescription,
    fitAndUse: context || 'Daily wear',
    care: 'Follow the care label instructions for best longevity.',
  };
  return {
    shortDescription,
    longDescription,
    structured,
  };
}

function buildDynamicSpecs({
  category,
  subcategory,
  attributes,
  description,
  name,
  brand,
}) {
  const normalizedCategory = normalizeCategory(category, subcategory);
  const config = CATEGORY_SPEC_CONFIG[normalizedCategory] || CATEGORY_SPEC_CONFIG.generic;
  const cleanedAttributes = sanitizeAttributes(attributes);
  const sections = [];

  for (const section of config.sections) {
    const items = [];
    for (const field of section.fields) {
      const rawValue =
        cleanedAttributes[field] ||
        cleanedAttributes[field.replace(/_/g, ' ')] ||
        valueFromDescription({ field, description, name });
      const value = normalizeText(rawValue);
      if (!value) continue;
      items.push({
        key: field,
        label: FIELD_LABELS[field] || field.replace(/_/g, ' '),
        value,
      });
    }
    if (items.length > 0) {
      sections.push({
        title: section.title,
        items,
      });
    }
  }

  return {
    category: normalizedCategory,
    sections,
    descriptions: buildDescriptionBundle({
      name,
      brand,
      category: normalizedCategory,
      subcategory,
      description,
    }),
  };
}

module.exports = {
  CATEGORY_SPEC_CONFIG,
  normalizeCategory,
  buildDynamicSpecs,
};

