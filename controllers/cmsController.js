const mongoose = require('mongoose');

const CmsEntry = require('../models/CmsEntry');
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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeType(value) {
  const normalized = value?.toString().trim().toLowerCase() || 'page';
  return ['page', 'faq', 'announcement', 'navigation'].includes(normalized) ? normalized : 'page';
}

function toPayload(body = {}, existing = null) {
  const type = normalizeType(body.type || existing?.type);
  const titleSource =
    body.title || body.question || body.label || body.name || existing?.title || '';
  const slugSource = body.slug || body.title || body.question || body.label || titleSource;

  return {
    type,
    title: titleSource.toString().trim() || existing?.title || '',
    slug: toSlug(slugSource),
    category: body.category?.toString().trim() || existing?.category || '',
    summary: body.summary?.toString().trim() || body.excerpt?.toString().trim() || '',
    content: body.content?.toString().trim() || body.answer?.toString().trim() || '',
    image: body.image?.toString().trim() || body.imageUrl?.toString().trim() || existing?.image || '',
    linkUrl: body.linkUrl?.toString().trim() || existing?.linkUrl || '',
    linkLabel: body.linkLabel?.toString().trim() || existing?.linkLabel || '',
    section: body.section?.toString().trim() || existing?.section || '',
    sortOrder: toNumber(body.sortOrder ?? body.order, existing?.sortOrder ?? 0),
    isFeatured: toBoolean(body.isFeatured, existing?.isFeatured ?? false),
    isActive: toBoolean(body.isActive, existing?.isActive ?? true),
    seoTitle: body.seoTitle?.toString().trim().slice(0, 120) || '',
    seoDescription: body.seoDescription?.toString().trim().slice(0, 320) || '',
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : existing?.publishedAt || null,
  };
}

function serializeEntry(item) {
  return {
    id: item._id?.toString?.() || '',
    type: item.type || 'page',
    title: item.title || '',
    slug: item.slug || '',
    category: item.category || '',
    summary: item.summary || '',
    content: item.content || '',
    image: item.image || '',
    linkUrl: item.linkUrl || '',
    linkLabel: item.linkLabel || '',
    section: item.section || '',
    sortOrder: Number(item.sortOrder || 0),
    isFeatured: item.isFeatured === true,
    isActive: item.isActive !== false,
    seoTitle: item.seoTitle || '',
    seoDescription: item.seoDescription || '',
    publishedAt: item.publishedAt?.toISOString?.() || '',
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
  };
}

async function resolveUniqueSlug(type, slugBase, excludeId = null) {
  const normalized = toSlug(slugBase);
  if (!normalized) {
    return '';
  }

  let candidate = normalized;
  let counter = 2;
  while (await CmsEntry.exists({
    type,
    slug: candidate,
    deletedAt: null,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })) {
    candidate = `${normalized}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function buildQuery(req) {
  const query = { deletedAt: null };
  const type = normalizeType(req.query?.type);
  query.type = type;

  const status = req.query?.status?.toString().trim().toLowerCase() || 'all';
  if (status === 'active') {
    query.isActive = true;
  } else if (status === 'inactive') {
    query.isActive = false;
  }

  const search = req.query?.search?.toString().trim() || '';
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } },
      { summary: { $regex: search, $options: 'i' } },
      { content: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { section: { $regex: search, $options: 'i' } },
    ];
  }

  const category = req.query?.category?.toString().trim() || '';
  if (category) {
    query.category = { $regex: `^${category}$`, $options: 'i' };
  }

  const featured = req.query?.featured?.toString().trim().toLowerCase() || 'all';
  if (featured === 'true' || featured === 'featured') {
    query.isFeatured = true;
  } else if (featured === 'false' || featured === 'unfeatured') {
    query.isFeatured = false;
  }

  const section = req.query?.section?.toString().trim() || '';
  if (section) {
    query.section = { $regex: `^${section}$`, $options: 'i' };
  }

  const published = req.query?.published?.toString().trim().toLowerCase() || 'all';
  if (published === 'true') {
    query.publishedAt = { $ne: null };
  } else if (published === 'false') {
    query.publishedAt = null;
  }

  return query;
}

function resolveSort(req) {
  const sortBy = req.query?.sortBy?.toString().trim() || 'sortOrder';
  const direction = req.query?.sortDirection?.toString().trim().toLowerCase() === 'desc' ? -1 : 1;
  if (['title', 'slug', 'sortOrder', 'createdAt', 'updatedAt', 'publishedAt'].includes(sortBy)) {
    return { [sortBy]: direction };
  }
  return { sortOrder: 1, createdAt: 1 };
}

async function getCmsEntries(req, res, next) {
  try {
    const isAdmin = (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    const wantsPagination =
      Boolean(req.query?.page || req.query?.limit || req.query?.search || req.query?.status || req.query?.category || req.query?.featured || req.query?.section || req.query?.published);

    if (!isAdmin && wantsPagination) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const query = buildQuery(req);
    const sort = resolveSort(req);
    const page = Math.max(1, parseInt(req.query?.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit || '20', 10) || 20));

    if (isAdmin || wantsPagination) {
      const [totalCount, items] = await Promise.all([
        CmsEntry.countDocuments(query),
        CmsEntry.find(query)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      return res.status(200).json({
        success: true,
        data: items.map(serializeEntry),
        meta: {
          page,
          limit,
          totalCount,
          totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        },
      });
    }

    const items = await CmsEntry.find(query).sort(sort).lean();
    return res.status(200).json({
      success: true,
      data: items.map(serializeEntry),
    });
  } catch (error) {
    return next(error);
  }
}

async function getCmsEntryBySlug(req, res, next) {
  try {
    const type = normalizeType(req.params.type || req.query?.type);
    const slug = toSlug(req.params.slug || req.query?.slug);
    if (!slug) {
      return res.status(400).json({ success: false, message: 'slug is required.' });
    }
    const item = await CmsEntry.findOne({
      type,
      slug,
      deletedAt: null,
      isActive: true,
      publishedAt: { $ne: null },
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'CMS content not found.' });
    }
    return res.status(200).json({ success: true, data: serializeEntry(item) });
  } catch (error) {
    return next(error);
  }
}

async function createCmsEntry(req, res, next) {
  try {
    const isAdmin = (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const payload = toPayload(req.body);
    if (!payload.title) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }

    payload.slug = await resolveUniqueSlug(payload.type, payload.slug || payload.title);
    if (!payload.slug) {
      return res.status(400).json({ success: false, message: 'Slug is required.' });
    }

    const created = await CmsEntry.create(payload);
    return res.status(201).json({ success: true, data: serializeEntry(created) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'CMS slug already exists.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function updateCmsEntry(req, res, next) {
  try {
    const isAdmin = (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid CMS entry id.' });
    }

    const entry = await CmsEntry.findOne({ _id: id, deletedAt: null });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'CMS content not found.' });
    }

    const payload = toPayload(req.body, entry);
    if (!payload.title) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }

    if (payload.type !== entry.type) {
      entry.type = payload.type;
    }
    if (payload.slug !== entry.slug || payload.type !== entry.type) {
      payload.slug = await resolveUniqueSlug(payload.type, payload.slug || payload.title, entry._id);
    }

    entry.title = payload.title;
    entry.slug = payload.slug;
    entry.category = payload.category;
    entry.summary = payload.summary;
    entry.content = payload.content;
    entry.image = payload.image;
    entry.linkUrl = payload.linkUrl;
    entry.linkLabel = payload.linkLabel;
    entry.section = payload.section;
    entry.sortOrder = payload.sortOrder;
    entry.isFeatured = payload.isFeatured;
    entry.isActive = payload.isActive;
    entry.seoTitle = payload.seoTitle;
    entry.seoDescription = payload.seoDescription;
    entry.publishedAt = payload.publishedAt;
    await entry.save();

    return res.status(200).json({ success: true, data: serializeEntry(entry) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'CMS slug already exists.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteCmsEntry(req, res, next) {
  try {
    const isAdmin = (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid CMS entry id.' });
    }

    const entry = await CmsEntry.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), isActive: false } },
      { new: true },
    );
    if (!entry) {
      return res.status(404).json({ success: false, message: 'CMS content not found.' });
    }

    return res.status(200).json({ success: true, data: { id } });
  } catch (error) {
    return next(error);
  }
}

async function toggleCmsStatus(req, res, next) {
  try {
    const isAdmin = (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid CMS entry id.' });
    }

    const entry = await CmsEntry.findOne({ _id: id, deletedAt: null });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'CMS content not found.' });
    }

    entry.isActive = toBoolean(req.body?.isActive, !entry.isActive);
    if (toBoolean(req.body?.published, false)) {
      entry.publishedAt = entry.publishedAt || new Date();
    }
    await entry.save();

    return res.status(200).json({ success: true, data: serializeEntry(entry) });
  } catch (error) {
    return next(error);
  }
}

async function reorderCmsEntries(req, res, next) {
  try {
    const isAdmin = (req.user?.role === 'admin' || req.user?.role === 'super_admin') &&
      isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
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
            update: { $set: { sortOrder } },
          },
        };
      })
      .filter(Boolean);

    if (!operations.length) {
      return res.status(400).json({ success: false, message: 'No valid CMS entries supplied.' });
    }

    await CmsEntry.bulkWrite(operations);
    return res.status(200).json({ success: true, data: { updated: operations.length } });
  } catch (error) {
    return next(error);
  }
}

async function getCmsFaqs(req, res, next) {
  try {
    const items = await CmsEntry.find({
      type: 'faq',
      deletedAt: null,
      isActive: true,
      publishedAt: { $ne: null },
    }).sort({ sortOrder: 1, createdAt: 1 });
    return res.status(200).json({
      success: true,
      data: items.map(serializeEntry).map((item) => ({
        id: item.id,
        question: item.title,
        answer: item.content,
        category: item.category || 'general',
      })),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getCmsEntries,
  getCmsEntryBySlug,
  createCmsEntry,
  updateCmsEntry,
  deleteCmsEntry,
  toggleCmsStatus,
  reorderCmsEntries,
  getCmsFaqs,
};
