const mongoose = require('mongoose');

const Category = require('../models/category.model');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function toSlug(value) {
  return value
    ?.toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || '';
}

function toCategoryPayload(body = {}) {
  const normalizedOrder = Number(body.order ?? 0);
  const normalizedPriority = Number(body.priorityScore ?? 0);
  return {
    name: body.name?.toString().trim() || '',
    slug: toSlug(body.slug || body.name),
    icon: body.icon?.toString().trim() || '',
    order: Number.isFinite(normalizedOrder) ? normalizedOrder : 0,
    isActive: body.isActive !== false,
    featured: body.featured === true,
    seoTitle: body.seoTitle?.toString().trim().slice(0, 120) || '',
    seoDescription: body.seoDescription?.toString().trim().slice(0, 320) || '',
    priorityScore: Number.isFinite(normalizedPriority) ? normalizedPriority : 0,
  };
}

function toSubcategoryPayload(body = {}) {
  const normalizedOrder = Number(body.order ?? 0);
  return {
    name: body.name?.toString().trim() || '',
    slug: toSlug(body.slug || body.name),
    icon: body.icon?.toString().trim() || '',
    order: Number.isFinite(normalizedOrder) ? normalizedOrder : 0,
    isActive: body.isActive !== false,
  };
}

function serializeSubcategory(item) {
  return {
    id: item._id?.toString?.() || '',
    name: item.name || '',
    slug: item.slug || '',
    icon: item.icon || '',
    order: Number(item.order || 0),
    isActive: item.isActive !== false,
  };
}

function serializeCategory(item, { activeOnly = false } = {}) {
  const subcategories = Array.isArray(item.subcategories) ? item.subcategories : [];
  const filteredSubcategories = subcategories
    .filter((entry) => (activeOnly ? entry.isActive !== false : true))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map(serializeSubcategory);

  return {
    id: item._id?.toString?.() || '',
    name: item.name || '',
    slug: item.slug || '',
    icon: item.icon || '',
    order: Number(item.order || 0),
    isActive: item.isActive !== false,
    featured: item.featured === true,
    seoTitle: item.seoTitle || '',
    seoDescription: item.seoDescription || '',
    priorityScore: Number(item.priorityScore || 0),
    subcategories: filteredSubcategories,
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

async function createCategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const payload = toCategoryPayload(req.body);
    if (!payload.name || !payload.slug) {
      return res.status(400).json({
        success: false,
        message: 'Category name and slug are required.',
      });
    }

    const created = await Category.create(payload);
    return res.status(201).json({
      success: true,
      data: serializeCategory(created),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Category slug already exists.',
      });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function getCategories(req, res, next) {
  try {
    const isPrivilegedRequest =
      (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);

    const categories = await Category.find(isPrivilegedRequest ? {} : { isActive: true }).sort({
      order: 1,
      createdAt: 1,
    });
    return res.status(200).json({
      success: true,
      data: categories.map((item) =>
        serializeCategory(item, { activeOnly: !isPrivilegedRequest }),
      ),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const payload = toCategoryPayload(req.body);
    if (!payload.name || !payload.slug) {
      return res.status(400).json({
        success: false,
        message: 'Category name and slug are required.',
      });
    }

    category.name = payload.name;
    category.slug = payload.slug;
    category.icon = payload.icon;
    category.order = payload.order;
    category.isActive = payload.isActive;
    category.featured = payload.featured;
    category.seoTitle = payload.seoTitle;
    category.seoDescription = payload.seoDescription;
    category.priorityScore = payload.priorityScore;
    await category.save();

    return res.status(200).json({
      success: true,
      data: serializeCategory(category),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Category slug already exists.',
      });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteCategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const removed = await Category.findByIdAndDelete(id);
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    return res.status(200).json({
      success: true,
      data: { id },
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleCategoryStatus(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    category.isActive = req.body?.isActive === false ? false : !category.isActive;
    await category.save();

    return res.status(200).json({
      success: true,
      data: serializeCategory(category),
    });
  } catch (error) {
    return next(error);
  }
}

async function addSubcategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const payload = toSubcategoryPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required.' });
    }

    category.subcategories.push(payload);
    await category.save();
    const created = category.subcategories[category.subcategories.length - 1];

    return res.status(201).json({
      success: true,
      data: serializeSubcategory(created),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function updateSubcategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id, subId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subId)) {
      return res.status(400).json({ success: false, message: 'Invalid category or subcategory id.' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const subcategory = category.subcategories.id(subId);
    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found.' });
    }

    const payload = toSubcategoryPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required.' });
    }

    subcategory.name = payload.name;
    subcategory.slug = payload.slug;
    subcategory.icon = payload.icon;
    subcategory.order = payload.order;
    subcategory.isActive = payload.isActive;
    await category.save();

    return res.status(200).json({
      success: true,
      data: serializeSubcategory(subcategory),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteSubcategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id, subId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subId)) {
      return res.status(400).json({ success: false, message: 'Invalid category or subcategory id.' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const subcategory = category.subcategories.id(subId);
    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found.' });
    }

    subcategory.deleteOne();
    await category.save();

    return res.status(200).json({
      success: true,
      data: { id: subId },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  toggleCategoryStatus,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory,
};
