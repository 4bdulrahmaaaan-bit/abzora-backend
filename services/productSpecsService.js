const {
  ATTRIBUTE_TEMPLATE_REGISTRY,
  FIELD_LABELS,
  getAttributeTemplateForCategory,
  normalizeCategoryKey,
  sanitizeStructuredAttributes,
  templateToSections,
} = require('../config/productAttributeConfig');

function normalizeText(value) {
  return (value || '').toString().trim();
}

function sanitizeFlatAttributes(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [normalizeText(key).toLowerCase(), normalizeText(value)])
      .filter(([key, value]) => key && value),
  );
}

function buildDescriptionBundle({ name, brand, category, subcategory, description }) {
  const cleanDescription = normalizeText(description).replace(/\s+/g, ' ');
  const identity = [normalizeText(brand), normalizeText(name)].filter(Boolean).join(' ');
  const context = [normalizeText(category), normalizeText(subcategory)].filter(Boolean).join(' • ');
  const shortDescription =
    cleanDescription || `${identity || 'This product'} delivers premium quality and reliable everyday comfort.`;
  const longDescription = `${shortDescription}${context ? ` Designed for ${context.toLowerCase()}.` : ''} Crafted for comfort, style, and reliable daily use.`;
  return {
    shortDescription,
    longDescription,
    structured: {
      highlight: shortDescription.split('.').filter(Boolean)[0] || shortDescription,
      fitAndUse: context || 'Daily wear',
      care: 'Follow the care label instructions for best longevity.',
    },
  };
}

function buildDynamicSpecs({
  category,
  subcategory,
  attributes,
  structuredAttributes,
  description,
  name,
  brand,
}) {
  const normalizedCategory = normalizeCategoryKey(category, subcategory);
  const template = getAttributeTemplateForCategory(normalizedCategory, subcategory);
  const normalizedStructured = sanitizeStructuredAttributes(
    normalizedCategory,
    structuredAttributes,
    sanitizeFlatAttributes(attributes),
  );
  const sections = templateToSections(template, normalizedStructured.structuredAttributes).map((section) => {
    const items = section.fields
      .filter((field) => field.value != null && `${field.value}`.trim() !== '')
      .map((field) => ({
        key: field.key,
        label: field.label || FIELD_LABELS[field.key] || field.key.replace(/_/g, ' '),
        value: Array.isArray(field.value) ? field.value.join(', ') : `${field.value}`,
      }));
    return {
      title: section.title,
      items,
    };
  });

  return {
    category: normalizedCategory,
    templateKey: normalizedStructured.templateKey || template.key,
    templateVersion: normalizedStructured.templateVersion || Number(template.version || 1),
    sections: sections.filter((section) => section.items.length > 0),
    descriptions: buildDescriptionBundle({
      name,
      brand,
      category: normalizedCategory,
      subcategory,
      description,
    }),
  };
}

const CATEGORY_SPEC_CONFIG = Object.fromEntries(
  Object.entries(ATTRIBUTE_TEMPLATE_REGISTRY).map(([key, template]) => [
    key,
    {
      sections: templateToSections({ ...template, key }, []).map((section) => ({
        title: section.title,
        fields: section.fields.map((field) => field.key),
      })),
    },
  ]),
);

function sanitizeAttributes(raw = {}) {
  return sanitizeFlatAttributes(raw);
}

module.exports = {
  CATEGORY_SPEC_CONFIG,
  normalizeCategory: normalizeCategoryKey,
  buildDynamicSpecs,
  sanitizeAttributes,
};
