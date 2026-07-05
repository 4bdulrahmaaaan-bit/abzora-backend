require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');

function normalizeText(value, fallback = '') {
  const text = value == null ? '' : String(value).trim();
  return text || fallback;
}

function normalizeBool(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(text)) return true;
  if (['false', '0', 'no'].includes(text)) return false;
  return fallback;
}

function normalizeSizeQuantities(product) {
  const sizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean) : [];
  const quantity = Number(product.stock || 0);
  return Object.fromEntries(sizes.map((size) => [String(size).trim(), quantity]));
}

function buildVendorMeta(product) {
  const existingMeta =
    product.vendorMeta && typeof product.vendorMeta === 'object' && !Array.isArray(product.vendorMeta)
      ? Object.fromEntries(Object.entries(product.vendorMeta))
      : {};
  const attributes =
    product.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? Object.fromEntries(Object.entries(product.attributes))
      : {};

  const readString = (key, fallback = '') => {
    const candidates = [
      existingMeta[key],
      existingMeta[`vendor_${key}`],
      attributes[key],
      attributes[`vendor_${key}`],
    ];
    for (const candidate of candidates) {
      const value = normalizeText(candidate);
      if (value) return value;
    }
    return fallback;
  };

  const readBool = (key, fallback = false) => {
    const candidates = [
      existingMeta[key],
      existingMeta[`vendor_${key}`],
      attributes[key],
      attributes[`vendor_${key}`],
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'boolean') return candidate;
      const value = String(candidate ?? '').trim().toLowerCase();
      if (['true', '1', 'yes'].includes(value)) return true;
      if (['false', '0', 'no'].includes(value)) return false;
    }
    return fallback;
  };

  const meta = {
    ...existingMeta,
    collection: readString('collection', ''),
    barcode: readString('barcode', ''),
    lowStockThreshold: Number.parseInt(readString('lowStockThreshold', '5'), 10) || 5,
    taxIncluded: readBool('taxIncluded', true),
    sameDayDelivery: readBool('sameDayDelivery', product.deliveryInfo?.sameDayEligible === true),
    cashOnDelivery: readBool('cashOnDelivery', product.deliveryInfo?.cashOnDelivery === true),
    freeReturns: readBool('freeReturns', product.deliveryInfo?.freeReturns !== false),
    tryBeforeYouBuy: readBool('tryBeforeYouBuy', false),
    expressDelivery: readBool('expressDelivery', false),
    etaLabel: readString('etaLabel', normalizeText(product.deliveryInfo?.etaLabel, '3-5 Days')),
    sizeQuantities: existingMeta.sizeQuantities || JSON.stringify(normalizeSizeQuantities(product)),
  };

  return meta;
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const cursor = Product.find({}).cursor();
  let scanned = 0;
  let updated = 0;

  for await (const product of cursor) {
    scanned += 1;
    const vendorMeta = buildVendorMeta(product);
    const currentMeta =
      product.vendorMeta && typeof product.vendorMeta === 'object' && !Array.isArray(product.vendorMeta)
        ? JSON.stringify(Object.fromEntries(Object.entries(product.vendorMeta)))
        : '';
    const nextMeta = JSON.stringify(vendorMeta);

    if (currentMeta === nextMeta) {
      continue;
    }

    product.vendorMeta = vendorMeta;
    await product.save();
    updated += 1;
  }

  console.log(JSON.stringify({ scanned, updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore
    }
  });
