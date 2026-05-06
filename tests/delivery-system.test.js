const assert = require('node:assert/strict');

const mongoose = require('mongoose');
const { checkDeliveryAvailability, trackOrder } = require('../controllers/logisticsController');
const { deliveryCheck } = require('../services/hyperlocalDeliveryService');
const Product = require('../models/Product');
const Store = require('../models/Store');
const Order = require('../models/Order');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function testDeliveryCheckUnavailable() {
  const originalFindById = Product.findById;
  Product.findById = () => ({
    select: () => ({
      lean: async () => ({ _id: 'p1', stock: 0, sameDayEligible: true, storeId: 's1' }),
    }),
  });
  try {
    const result = await deliveryCheck({ productId: '6817618db0b2f53f0f97f744', lat: 12.9, lng: 77.5, pincode: '560001' });
    assert.equal(result.available, false);
  } finally {
    Product.findById = originalFindById;
  }
}

async function testCheckDeliveryAvailabilityValidation() {
  const req = { query: { product_id: '' } };
  const res = createRes();
  await checkDeliveryAvailability(req, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /product_id is required/i);
}

async function testTrackOrderVendorAccess() {
  const originalOrderFindById = Order.findById;
  const originalStoreFindById = Store.findById;
  const orderId = new mongoose.Types.ObjectId().toString();

  Order.findById = () => ({
    select: async () => ({
      _id: orderId,
      userId: 'u1',
      riderId: 'r1',
      storeId: 'store1',
      deliveryStatus: 'Assigned',
      orderStatus: 'confirmed',
    }),
  });
  Store.findById = () => ({
    select: () => ({
      lean: async () => ({ ownerId: 'vendor-owner' }),
    }),
  });

  const req = {
    params: { id: orderId },
    user: { uid: 'vendor-other', role: 'vendor', roles: { vendor: true } },
  };
  const res = createRes();
  try {
    await trackOrder(req, res, () => {});
    assert.equal(res.statusCode, 403);
  } finally {
    Order.findById = originalOrderFindById;
    Store.findById = originalStoreFindById;
  }
}

async function run() {
  await testDeliveryCheckUnavailable();
  await testCheckDeliveryAvailabilityValidation();
  await testTrackOrderVendorAccess();
  // eslint-disable-next-line no-console
  console.log('delivery-system tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('delivery-system tests failed:', error);
  process.exitCode = 1;
});
