const ProductAttributeTemplate = require('../models/ProductAttributeTemplate');
const { ATTRIBUTE_TEMPLATE_REGISTRY, normalizeCategoryKey } = require('../config/productAttributeConfig');
const { isAllowedAdminEmail } = require('./authController');

function isAdminUser(req) {
  return (
    ['admin', 'super_admin'].includes((req.user?.role || '').toLowerCase()) &&
    isAllowedAdminEmail(req.user?.email || req.dbUser?.email)
  );
}

function normalizeSectionPayload(sections = []) {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section, sectionIndex) => {
      if (!section || typeof section !== 'object') return null;
      const title = section.title?.toString().trim() || '';
      const fields = Array.isArray(section.fields)
        ? section.fields
            .map((field, fieldIndex) => {
              if (!field || typeof field !== 'object') return null;
              const key = field.key?.toString().trim() || '';
              const label = field.label?.toString().trim() || key;
              if (!key || !label) return null;
              return {
                key,
                label,
                type: field.type?.toString().trim() || 'text',
                required: field.required === true,
                readOnly: field.readOnly === true,
                filterable: field.filterable !== false,
                variantSupport: field.variantSupport === true,
                unit: field.unit?.toString().trim() || '',
                options: Array.isArray(field.options)
                  ? field.options.map((option) => option?.toString().trim()).filter(Boolean)
                  : [],
                order: Number.isFinite(Number(field.order)) ? Number(field.order) : fieldIndex,
              };
            })
            .filter(Boolean)
        : [];
      if (!title || fields.length === 0) return null;
      return {
        title,
        fields,
        order: sectionIndex,
      };
    })
    .filter(Boolean);
}

function serializeTemplate(template) {
  if (!template) {
    return null;
  }
  const source = typeof template.toObject === 'function' ? template.toObject() : template;
  return {
    id: source._id?.toString?.() || source.id || '',
    templateKey: source.templateKey || '',
    label: source.label || '',
    categoryKey: source.categoryKey || 'generic',
    subcategoryMatch: source.subcategoryMatch || '',
    version: Number(source.version || 1),
    isDefault: source.isDefault === true,
    isSystem: source.isSystem === true,
    sections: Array.isArray(source.sections)
      ? source.sections.map((section) => ({
          title: section.title || '',
          fields: Array.isArray(section.fields)
            ? section.fields.map((field) => ({
                key: field.key || '',
                label: field.label || '',
                type: field.type || 'text',
                required: Boolean(field.required),
                readOnly: Boolean(field.readOnly),
                filterable: field.filterable !== false,
                variantSupport: Boolean(field.variantSupport),
                unit: field.unit || '',
                options: Array.isArray(field.options) ? field.options : [],
                order: Number(field.order || 0),
              }))
            : [],
        }))
      : [],
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function seedMissingSystemTemplates() {
  const existingCount = await ProductAttributeTemplate.countDocuments({ isSystem: true });
  if (existingCount > 0) {
    return;
  }

  const seeds = Object.entries(ATTRIBUTE_TEMPLATE_REGISTRY).map(([templateKey, template]) => ({
    templateKey,
    label: template.label || templateKey,
    categoryKey: templateKey,
    version: Number(template.version || 1),
    isDefault: templateKey === 'generic',
    isSystem: true,
    sections: normalizeSectionPayload(
      template.sections.map((section) => ({
        title: section.title,
        fields: (section.fields || []).map((fieldKey, fieldIndex) => {
          const field = template.fields?.[fieldKey] || {};
          return {
            key: fieldKey,
            label: field.label || fieldKey,
            type: field.type || 'text',
            required: field.required === true,
            readOnly: field.readOnly === true,
            filterable: field.filterable !== false,
            variantSupport: field.variantSupport === true,
            unit: field.unit || '',
            options: Array.isArray(field.options) ? field.options : [],
            order: field.order ?? fieldIndex,
          };
        }),
      })),
    ),
  }));

  if (seeds.length > 0) {
    await ProductAttributeTemplate.insertMany(seeds, { ordered: false }).catch(() => {});
  }
}

async function listProductAttributeTemplates(req, res, next) {
  try {
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    await seedMissingSystemTemplates();
    const templates = await ProductAttributeTemplate.find({}).sort({ isDefault: -1, label: 1 });
    return res.status(200).json({
      success: true,
      data: templates.map(serializeTemplate),
    });
  } catch (error) {
    return next(error);
  }
}

async function getProductAttributeTemplate(req, res, next) {
  try {
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    await seedMissingSystemTemplates();
    const { templateKey } = req.params;
    const template = await ProductAttributeTemplate.findOne({
      templateKey: String(templateKey || '').trim(),
    });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }
    return res.status(200).json({ success: true, data: serializeTemplate(template) });
  } catch (error) {
    return next(error);
  }
}

async function upsertProductAttributeTemplate(req, res, next) {
  try {
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const templateKey = String(req.body?.templateKey || '').trim().toLowerCase();
    const label = String(req.body?.label || '').trim();
    const categoryKey = normalizeCategoryKey(req.body?.categoryKey || templateKey, req.body?.subcategoryMatch || '');
    const version = Number(req.body?.version || 1);
    const sections = normalizeSectionPayload(req.body?.sections || []);

    if (!templateKey || !label || sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'templateKey, label, and at least one section are required.',
      });
    }

    const payload = {
      templateKey,
      label,
      categoryKey,
      subcategoryMatch: String(req.body?.subcategoryMatch || '').trim(),
      version: Number.isFinite(version) && version > 0 ? version : 1,
      isDefault: req.body?.isDefault === true,
      isSystem: req.body?.isSystem === true,
      sections,
      updatedBy: String(req.user?.uid || ''),
    };

    const updated = await ProductAttributeTemplate.findOneAndUpdate(
      { templateKey },
      { $set: payload, $setOnInsert: { createdBy: String(req.user?.uid || '') } },
      { upsert: true, new: true, runValidators: true },
    );

    return res.status(200).json({ success: true, data: serializeTemplate(updated) });
  } catch (error) {
    return next(error);
  }
}

async function deleteProductAttributeTemplate(req, res, next) {
  try {
    if (!isAdminUser(req)) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const { templateKey } = req.params;
    const template = await ProductAttributeTemplate.findOne({
      templateKey: String(templateKey || '').trim(),
    });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }
    if (template.isSystem) {
      return res.status(400).json({ success: false, message: 'System templates cannot be deleted.' });
    }
    await template.deleteOne();
    return res.status(200).json({ success: true, data: { templateKey } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listProductAttributeTemplates,
  getProductAttributeTemplate,
  upsertProductAttributeTemplate,
  deleteProductAttributeTemplate,
};
