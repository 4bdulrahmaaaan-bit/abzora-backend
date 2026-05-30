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

function toBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
}

function toNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function toCategoryPayload(body = {}, existing = null) {
  const slugSource = body.slug || body.name || existing?.name || '';
  const tabType = ['All', 'Men', 'Women', 'Kids'].includes(body.tabType)
    ? body.tabType
    : existing?.tabType || 'All';

  return {
    name: body.name?.toString().trim() || existing?.name || '',
    slug: toSlug(slugSource),
    description: body.description?.toString().trim() || '',
    icon: body.image?.toString().trim() || body.icon?.toString().trim() || existing?.icon || '',
    bannerImage:
      body.bannerImage?.toString().trim() ||
      body.bannerImageUrl?.toString().trim() ||
      existing?.bannerImage ||
      '',
    parentId: body.parentId?.toString().trim() || body.parent_id?.toString().trim() || null,
    order: toNumber(body.sortOrder ?? body.order, existing?.order ?? 0),
    isFeatured: toBoolean(body.isFeatured ?? body.featured, existing?.isFeatured ?? false),
    isActive: toBoolean(body.isActive, existing?.isActive ?? true),
    showOnHome: toBoolean(body.showOnHome, existing?.showOnHome ?? false),
    tabType,
    seoTitle: body.seoTitle?.toString().trim().slice(0, 120) || '',
    seoDescription: body.seoDescription?.toString().trim().slice(0, 320) || '',
  };
}

function serializeSubcategory(item, parentName = '') {
  return {
    id: item._id?.toString?.() || '',
    name: item.name || '',
    slug: item.slug || '',
    description: item.description || '',
    image: item.icon || '',
    icon: item.icon || '',
    bannerImage: item.bannerImage || '',
    parentId: item.parentId?.toString?.() || '',
    parentName,
    sortOrder: Number(item.order || 0),
    order: Number(item.order || 0),
    isFeatured: item.isFeatured === true,
    featured: item.isFeatured === true,
    isActive: item.isActive !== false,
    showOnHome: item.showOnHome === true,
    tabType: item.tabType || 'All',
    seoTitle: item.seoTitle || '',
    seoDescription: item.seoDescription || '',
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    deletedAt: item.deletedAt?.toISOString?.() || '',
    subcategories: [],
  };
}

function serializeCategory(item, { parentName = '', children = [] } = {}) {
  return {
    id: item._id?.toString?.() || '',
    name: item.name || '',
    slug: item.slug || '',
    description: item.description || '',
    image: item.icon || '',
    icon: item.icon || '',
    bannerImage: item.bannerImage || '',
    parentId: item.parentId?.toString?.() || '',
    parentName,
    sortOrder: Number(item.order || 0),
    order: Number(item.order || 0),
    isFeatured: item.isFeatured === true,
    featured: item.isFeatured === true,
    isActive: item.isActive !== false,
    showOnHome: item.showOnHome === true,
    tabType: item.tabType || 'All',
    seoTitle: item.seoTitle || '',
    seoDescription: item.seoDescription || '',
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    deletedAt: item.deletedAt?.toISOString?.() || '',
    subcategories: children.map((entry) => serializeSubcategory(entry, item.name || '')),
  };
}

async function resolveUniqueSlug(baseSlug, excludeId = null) {
  const normalized = toSlug(baseSlug);
  if (!normalized) {
    return '';
  }

  let candidate = normalized;
  let counter = 2;
  while (await Category.exists({ slug: candidate, deletedAt: null, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    candidate = `${normalized}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function buildQuery(req) {
  const query = { deletedAt: null };
  const view = req.query?.view?.toString().trim() || '';
  const includeDeleted = toBoolean(req.query?.includeDeleted, false);

  if (includeDeleted) {
    query.deletedAt = { $ne: null };
  }

  const search = req.query?.search?.toString().trim() || '';
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  const status = req.query?.status?.toString().trim().toLowerCase() || 'all';
  if (status === 'active') {
    query.isActive = true;
  } else if (status === 'inactive') {
    query.isActive = false;
  }

  const featured = req.query?.featured?.toString().trim().toLowerCase() || 'all';
  if (featured === 'true' || featured === 'featured') {
    query.isFeatured = true;
  } else if (featured === 'false' || featured === 'unfeatured') {
    query.isFeatured = false;
  }

  const showOnHome = req.query?.showOnHome?.toString().trim().toLowerCase() || 'all';
  if (showOnHome === 'true') {
    query.showOnHome = true;
  } else if (showOnHome === 'false') {
    query.showOnHome = false;
  }

  const tabType = req.query?.tabType?.toString().trim() || '';
  if (tabType && ['All', 'Men', 'Women', 'Kids'].includes(tabType)) {
    query.tabType = tabType;
  }

  const parentId = req.query?.parentId?.toString().trim() || '';
  if (parentId === 'root') {
    query.parentId = null;
  } else if (parentId && mongoose.Types.ObjectId.isValid(parentId)) {
    query.parentId = parentId;
  }

  if (view === 'home') {
    query.isActive = true;
    query.showOnHome = true;
    query.parentId = null;
  }

  return { query, view };
}

function resolveSort(req) {
  const sortBy = req.query?.sortBy?.toString().trim() || 'order';
  const direction = req.query?.sortDirection?.toString().trim().toLowerCase() === 'desc' ? -1 : 1;
  if (['name', 'slug', 'order', 'createdAt', 'updatedAt'].includes(sortBy)) {
    return { [sortBy]: direction };
  }
  return { order: 1, createdAt: 1 };
}

async function softDeleteDescendants(parentId) {
  const descendants = await Category.find({
    parentId,
    deletedAt: null,
  }).select('_id');
  if (!descendants.length) {
    return 0;
  }

  const descendantIds = descendants.map((item) => item._id);
  await Category.updateMany(
    { _id: { $in: descendantIds } },
    { $set: { deletedAt: new Date(), isActive: false } },
  );

  let total = descendantIds.length;
  for (const childId of descendantIds) {
    total += await softDeleteDescendants(childId);
  }
  return total;
}

async function getCategories(req, res, next) {
  try {
    const { query, view } = buildQuery(req);
    const isPrivilegedRequest =
      (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);

    const wantsAdminView =
      view === 'admin' ||
      toBoolean(req.query?.adminView, false) ||
      Boolean(req.query?.page || req.query?.limit || req.query?.search || req.query?.status || req.query?.parentId || req.query?.featured || req.query?.showOnHome || req.query?.tabType);

    if (!isPrivilegedRequest && wantsAdminView) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const sort = resolveSort(req);
    const page = Math.max(1, parseInt(req.query?.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit || '20', 10) || 20));

    if (wantsAdminView) {
      const [totalCount, items] = await Promise.all([
        Category.countDocuments(query),
        Category.find(query)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      const parentIds = items
        .map((item) => item.parentId?.toString?.())
        .filter((value) => value && mongoose.Types.ObjectId.isValid(value));
      const parents = parentIds.length
        ? await Category.find({ _id: { $in: parentIds }, deletedAt: null }).lean()
        : [];
      const parentNameById = new Map(parents.map((item) => [item._id.toString(), item.name || '']));

      return res.status(200).json({
        success: true,
        data: items.map((item) =>
          serializeCategory(item, {
            parentName: parentNameById.get(item.parentId?.toString?.() || '') || '',
            children: [],
          }),
        ),
        meta: {
          page,
          limit,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        },
      });
    }

    const topLevelCategories = await Category.find({
      ...query,
      parentId: null,
    })
      .sort(sort)
      .lean();

    const children = await Category.find({
      deletedAt: null,
      isActive: true,
      parentId: { $in: topLevelCategories.map((item) => item._id) },
    })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    const childrenByParent = new Map();
    for (const child of children) {
      const key = child.parentId?.toString?.() || '';
      const bucket = childrenByParent.get(key) || [];
      bucket.push(child);
      childrenByParent.set(key, bucket);
    }

    return res.status(200).json({
      success: true,
      data: topLevelCategories.map((item) =>
        serializeCategory(item, {
          parentName: '',
          children: childrenByParent.get(item._id.toString()) || [],
        }),
      ),
    });
  } catch (error) {
    return next(error);
  }
}

async function createCategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const payload = toCategoryPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required.',
      });
    }

    payload.slug = await resolveUniqueSlug(payload.slug || payload.name);
    if (!payload.slug) {
      return res.status(400).json({
        success: false,
        message: 'Category slug is required.',
      });
    }

    payload.parentId = payload.parentId || null;

    if (payload.parentId && !mongoose.Types.ObjectId.isValid(payload.parentId)) {
      return res.status(400).json({ success: false, message: 'Invalid parent category.' });
    }

    if (payload.parentId) {
      const parent = await Category.findOne({ _id: payload.parentId, deletedAt: null });
      if (!parent) {
        return res.status(404).json({ success: false, message: 'Parent category not found.' });
      }
      if (!req.body?.tabType) {
        payload.tabType = parent.tabType || 'All';
      }
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

async function updateCategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const category = await Category.findOne({ _id: id, deletedAt: null });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const payload = toCategoryPayload(req.body, category);
    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required.',
      });
    }

    const hasParentField =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'parent_id');
    if (!hasParentField) {
      payload.parentId = category.parentId?.toString?.() || null;
    }

    if (payload.parentId === id) {
      return res.status(400).json({ success: false, message: 'A category cannot be its own parent.' });
    }

    if (payload.parentId && !mongoose.Types.ObjectId.isValid(payload.parentId)) {
      return res.status(400).json({ success: false, message: 'Invalid parent category.' });
    }

    payload.parentId = payload.parentId || null;

    if (payload.parentId) {
      const parent = await Category.findOne({ _id: payload.parentId, deletedAt: null });
      if (!parent) {
        return res.status(404).json({ success: false, message: 'Parent category not found.' });
      }
    }

    if (payload.slug !== category.slug) {
      payload.slug = await resolveUniqueSlug(payload.slug || payload.name, category._id);
    }

    category.name = payload.name;
    category.slug = payload.slug;
    category.description = payload.description;
    category.icon = payload.icon;
    category.bannerImage = payload.bannerImage;
    category.parentId = payload.parentId || null;
    category.order = payload.order;
    category.isFeatured = payload.isFeatured;
    category.isActive = payload.isActive;
    category.showOnHome = payload.showOnHome;
    category.tabType = payload.tabType;
    category.seoTitle = payload.seoTitle;
    category.seoDescription = payload.seoDescription;
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

async function softDeleteCategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const removed = await Category.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), isActive: false } },
      { new: true },
    );
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    await softDeleteDescendants(removed._id);

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

    const category = await Category.findOne({ _id: id, deletedAt: null });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    category.isActive = toBoolean(req.body?.isActive, !category.isActive);
    await category.save();

    return res.status(200).json({
      success: true,
      data: serializeCategory(category),
    });
  } catch (error) {
    return next(error);
  }
}

async function toggleCategoryFeatured(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid category id.' });
    }

    const category = await Category.findOne({ _id: id, deletedAt: null });
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    category.isFeatured = toBoolean(req.body?.isFeatured, !category.isFeatured);
    await category.save();

    return res.status(200).json({
      success: true,
      data: serializeCategory(category),
    });
  } catch (error) {
    return next(error);
  }
}

async function reorderCategories(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'items are required.' });
    }

    const operations = items
      .map((entry, index) => {
        const id = entry?.id?.toString?.() || '';
        if (!mongoose.Types.ObjectId.isValid(id)) {
          return null;
        }
        const sortOrder = toNumber(entry.sortOrder ?? entry.order, index);
        return {
          updateOne: {
            filter: { _id: id, deletedAt: null },
            update: { $set: { order: sortOrder } },
          },
        };
      })
      .filter(Boolean);

    if (!operations.length) {
      return res.status(400).json({ success: false, message: 'No valid categories supplied.' });
    }

    await Category.bulkWrite(operations);
    return res.status(200).json({ success: true, data: { updated: operations.length } });
  } catch (error) {
    return next(error);
  }
}

async function getFeaturedCategories(req, res, next) {
  try {
    const categories = await Category.find({
      deletedAt: null,
      isActive: true,
      isFeatured: true,
      parentId: null,
    }).sort({ order: 1, createdAt: 1 });

    return res.status(200).json({
      success: true,
      data: categories.map((item) => serializeCategory(item)),
    });
  } catch (error) {
    return next(error);
  }
}

async function getHomeCategories(req, res, next) {
  try {
    const tabType = req.query?.tabType?.toString().trim() || '';
    const query = {
      deletedAt: null,
      isActive: true,
      showOnHome: true,
      parentId: null,
    };
    if (tabType && ['All', 'Men', 'Women', 'Kids'].includes(tabType)) {
      query.tabType = tabType;
    }

    const categories = await Category.find(query).sort({ order: 1, createdAt: 1 });
    return res.status(200).json({
      success: true,
      data: categories.map((item) => serializeCategory(item)),
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

    const parent = await Category.findOne({ _id: id, deletedAt: null });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const payload = toCategoryPayload(req.body, parent);
    if (!payload.name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required.' });
    }

    payload.parentId = parent._id.toString();
    payload.tabType = payload.tabType || parent.tabType || 'All';
    payload.slug = await resolveUniqueSlug(payload.slug || payload.name);

    const created = await Category.create(payload);
    return res.status(201).json({
      success: true,
      data: serializeSubcategory(created, parent.name || ''),
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

    const parent = await Category.findOne({ _id: id, deletedAt: null });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const subcategory = await Category.findOne({ _id: subId, parentId: id, deletedAt: null });
    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found.' });
    }

    const payload = toCategoryPayload(req.body, subcategory);
    if (!payload.name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required.' });
    }

    if (payload.slug !== subcategory.slug) {
      payload.slug = await resolveUniqueSlug(payload.slug || payload.name, subcategory._id);
    }

    subcategory.name = payload.name;
    subcategory.slug = payload.slug;
    subcategory.description = payload.description;
    subcategory.icon = payload.icon;
    subcategory.bannerImage = payload.bannerImage;
    subcategory.order = payload.order;
    subcategory.isFeatured = payload.isFeatured;
    subcategory.isActive = payload.isActive;
    subcategory.showOnHome = payload.showOnHome;
    subcategory.tabType = payload.tabType;
    subcategory.seoTitle = payload.seoTitle;
    subcategory.seoDescription = payload.seoDescription;
    await subcategory.save();

    return res.status(200).json({
      success: true,
      data: serializeSubcategory(subcategory, parent.name || ''),
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

async function deleteSubcategory(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }

    const { id, subId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(subId)) {
      return res.status(400).json({ success: false, message: 'Invalid category or subcategory id.' });
    }

    const subcategory = await Category.findOne({ _id: subId, parentId: id, deletedAt: null });
    if (!subcategory) {
      return res.status(404).json({ success: false, message: 'Subcategory not found.' });
    }

    subcategory.deletedAt = new Date();
    subcategory.isActive = false;
    await subcategory.save();
    await softDeleteDescendants(subcategory._id);

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
  deleteCategory: softDeleteCategory,
  toggleCategoryStatus,
  toggleCategoryFeatured,
  reorderCategories,
  getFeaturedCategories,
  getHomeCategories,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory,
};
