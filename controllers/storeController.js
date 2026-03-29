const mongoose = require('mongoose');

const Store = require('../models/Store');

function serializeStore(store) {
  if (!store) {
    return null;
  }

  const source = typeof store.toObject === 'function' ? store.toObject() : store;
  return {
    id: source._id?.toString() || source.id || '',
    name: source.name || '',
    description: source.description || '',
    rating: Number(source.rating || 0),
    logoUrl: source.logoUrl || '',
    ownerId: source.ownerId || '',
    isActive: Boolean(source.isActive),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function createStore(req, res, next) {
  try {
    const { name, description, rating, logoUrl } = req.body || {};
    const ownerId = req.user?.uid?.toString().trim();
    const normalizedName = name?.toString().trim() || '';
    const normalizedDescription = description?.toString().trim() || '';

    if (!ownerId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!normalizedName) {
      return res.status(400).json({ success: false, message: 'Store name is required.' });
    }

    const store = await Store.create({
      name: normalizedName,
      rating: Number(rating || 0),
      description: normalizedDescription,
      logoUrl: logoUrl?.toString().trim() || '',
      ownerId,
    });

    return res.status(201).json({ success: true, data: serializeStore(store) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listStores(req, res, next) {
  try {
    const stores = await Store.find({ isActive: true })
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: stores.map(serializeStore) });
  } catch (error) {
    return next(error);
  }
}

async function getStore(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }

    const store = await Store.findById(id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }

    return res.status(200).json({ success: true, data: serializeStore(store) });
  } catch (error) {
    return next(error);
  }
}

async function getOwnStore(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const store = await Store.findOne({ ownerId: req.user.uid }).sort({ createdAt: -1 });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }

    return res.status(200).json({ success: true, data: serializeStore(store) });
  } catch (error) {
    return next(error);
  }
}

async function updateStore(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid store id.' });
    }

    const store = await Store.findById(id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (store.ownerId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'You can only update your own store.' });
    }

    const { name, description, logoUrl, isActive } = req.body || {};
    const normalizedName = name?.toString().trim() || store.name;
    if (!normalizedName) {
      return res.status(400).json({ success: false, message: 'Store name is required.' });
    }

    store.name = normalizedName;
    store.description = description?.toString().trim() ?? store.description;
    store.logoUrl = logoUrl?.toString().trim() ?? store.logoUrl;
    if (typeof isActive === 'boolean') {
      store.isActive = isActive;
    }
    await store.save();

    return res.status(200).json({ success: true, data: serializeStore(store) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

module.exports = {
  createStore,
  listStores,
  getStore,
  getOwnStore,
  updateStore,
};
