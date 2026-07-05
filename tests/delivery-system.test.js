const assert = require('node:assert/strict');

const mongoose = require('mongoose');
const { checkDeliveryAvailability, trackOrder } = require('../controllers/logisticsController');
const { deliveryCheck } = require('../services/hyperlocalDeliveryService');
const Product = require('../models/Product');
const Store = require('../models/Store');
const OpsZone = require('../models/OpsZone');
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

async function testCheckDeliveryAvailabilityPincodeOnlyTryAtHome() {
  const originalProductFindById = Product.findById;
  const originalStoreFindById = Store.findById;
  const originalZoneFind = OpsZone.find;

  Product.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 'p1',
        stock: 6,
        sameDayEligible: true,
        trialHome: { trialEnabled: true },
        storeId: 's1',
        deliveryInfo: {},
      }),
    }),
  });
  Store.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 's1',
        city: 'Chennai',
        latitude: null,
        longitude: null,
      }),
    }),
  });
  OpsZone.find = () => ({
    lean: async () => [
      {
        zoneId: 'chennai:1',
        city: 'Chennai',
        radiusKm: 10,
        center: { lat: 13.05, lng: 80.25 },
        metadata: { pincodes: ['600001'] },
      },
    ],
  });

  try {
    const req = {
      query: {
        product_id: '6817618db0b2f53f0f97f744',
        pincode: '600001',
      },
    };
    const res = createRes();
    await checkDeliveryAvailability(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isDeliverable, true);
    assert.equal(res.body.supportsTryAtHome, true);
    assert.equal(res.body.deliveryMode, 'TRY_AT_HOME');
  } finally {
    Product.findById = originalProductFindById;
    Store.findById = originalStoreFindById;
    OpsZone.find = originalZoneFind;
  }
}

async function testCheckDeliveryAvailabilityLocalityMatchTryAtHome() {
  const originalProductFindById = Product.findById;
  const originalStoreFindById = Store.findById;
  const originalZoneFind = OpsZone.find;

  Product.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 'p3',
        stock: 4,
        sameDayEligible: true,
        trialHome: { trialEnabled: true },
        storeId: 's3',
        deliveryInfo: {},
      }),
    }),
  });
  Store.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 's3',
        city: 'Chennai',
        latitude: null,
        longitude: null,
      }),
    }),
  });
  OpsZone.find = () => ({
    lean: async () => [
      {
        zoneId: 'chennai:2',
        city: 'Chennai',
        radiusKm: 10,
        center: { lat: 13.05, lng: 80.25 },
        metadata: { pincodes: ['600001'] },
      },
    ],
  });

  try {
    const req = {
      query: {
        product_id: '6817618db0b2f53f0f97f744',
        locality: 'Chennai',
        city: 'George Town',
        pincode: '600001',
      },
    };
    const res = createRes();
    await checkDeliveryAvailability(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isDeliverable, true);
    assert.equal(res.body.supportsTryAtHome, true);
    assert.equal(res.body.deliveryMode, 'TRY_AT_HOME');
  } finally {
    Product.findById = originalProductFindById;
    Store.findById = originalStoreFindById;
    OpsZone.find = originalZoneFind;
  }
}

async function testCheckDeliveryAvailabilityVendorMetaTryBeforeBuy() {
  const originalProductFindById = Product.findById;
  const originalStoreFindById = Store.findById;
  const originalZoneFind = OpsZone.find;

  Product.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 'p4',
        stock: 12,
        sameDayEligible: true,
        trialHome: { trialEnabled: false },
        vendorMeta: { tryBeforeYouBuy: true },
        storeId: 's4',
        deliveryInfo: { sameDayEligible: true },
      }),
    }),
  });
  Store.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 's4',
        city: 'Chennai',
        latitude: null,
        longitude: null,
        sameDay: { enabled: true, supportsTrialHome: true },
      }),
    }),
  });
  OpsZone.find = () => ({
    lean: async () => [
      {
        zoneId: 'chennai:3',
        city: 'Chennai',
        radiusKm: 10,
        center: { lat: 13.05, lng: 80.25 },
        metadata: { pincodes: ['600001'] },
      },
    ],
  });

  try {
    const req = {
      query: {
        product_id: '6817618db0b2f53f0f97f744',
        locality: 'George Town',
        city: 'Chennai',
        pincode: '600001',
      },
    };
    const res = createRes();
    await checkDeliveryAvailability(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isDeliverable, true);
    assert.equal(res.body.supportsTryAtHome, true);
    assert.equal(res.body.deliveryMode, 'TRY_AT_HOME');
  } finally {
    Product.findById = originalProductFindById;
    Store.findById = originalStoreFindById;
    OpsZone.find = originalZoneFind;
  }
}

async function testCheckDeliveryAvailabilityPincodeOnlyCourierFallback() {
  const originalProductFindById = Product.findById;
  const originalStoreFindById = Store.findById;
  const originalZoneFind = OpsZone.find;

  Product.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 'p2',
        stock: 4,
        sameDayEligible: false,
        trialHome: { trialEnabled: false },
        storeId: 's2',
        deliveryInfo: {},
      }),
    }),
  });
  Store.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: 's2',
        city: 'Bengaluru',
        latitude: null,
        longitude: null,
      }),
    }),
  });
  OpsZone.find = () => ({
    lean: async () => [],
  });

  try {
    const req = {
      query: {
        product_id: '6817618db0b2f53f0f97f744',
        pincode: '400001',
      },
    };
    const res = createRes();
    await checkDeliveryAvailability(req, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isDeliverable, true);
    assert.equal(res.body.supportsCourierDelivery, true);
    assert.equal(res.body.deliveryMode, 'COURIER_DELIVERY');
  } finally {
    Product.findById = originalProductFindById;
    Store.findById = originalStoreFindById;
    OpsZone.find = originalZoneFind;
  }
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
  await testCheckDeliveryAvailabilityPincodeOnlyTryAtHome();
  await testCheckDeliveryAvailabilityLocalityMatchTryAtHome();
  await testCheckDeliveryAvailabilityVendorMetaTryBeforeBuy();
  await testCheckDeliveryAvailabilityPincodeOnlyCourierFallback();
  await testTrackOrderVendorAccess();
  // eslint-disable-next-line no-console
  console.log('delivery-system tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('delivery-system tests failed:', error);
  process.exitCode = 1;
});
