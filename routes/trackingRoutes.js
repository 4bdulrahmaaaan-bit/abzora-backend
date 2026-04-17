const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  postLocationUpdate,
  postOrderStatusUpdate,
  getOrderEtaLive,
} = require('../controllers/trackingController');

const router = express.Router();

router.use(authMiddleware);

router.post('/location-update', postLocationUpdate);
router.post('/order-status-update', postOrderStatusUpdate);
router.get('/eta/:orderId', getOrderEtaLive);

module.exports = router;
