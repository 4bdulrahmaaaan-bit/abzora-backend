const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getCatalog,
  getQuote,
  saveMeasurementProfile,
  listMyAtelierOrders,
  getAtelierOrderTracking,
  updateAtelierTracking,
} = require('../controllers/atelierController');

const router = express.Router();

router.get('/catalog', getCatalog);
router.post('/quote', getQuote);

router.use(authMiddleware);

router.post('/measurements/save', saveMeasurementProfile);
router.get('/orders', listMyAtelierOrders);
router.get('/orders/:id/tracking', getAtelierOrderTracking);
router.patch('/orders/:id/tracking', updateAtelierTracking);

module.exports = router;
