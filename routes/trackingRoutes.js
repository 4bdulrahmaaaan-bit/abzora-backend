const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  trackingLocationUpdateSchema,
  trackingOrderStatusUpdateSchema,
} = require('../validation/schemas/customerSchemas');
const {
  postLocationUpdate,
  postOrderStatusUpdate,
  getOrderEtaLive,
} = require('../controllers/trackingController');

const { enableLocalRiderDelivery } = require('../services/deliveryModeService');

const router = express.Router();

router.use((req, res, next) => {
  if (!enableLocalRiderDelivery() && !req.path.includes('shiprocket')) {
    return res.status(403).json({ success: false, message: 'Local rider tracking is disabled.' });
  }
  next();
});


router.use(authMiddleware);

router.post('/location-update', validateBody(trackingLocationUpdateSchema), postLocationUpdate);
router.post('/order-status-update', validateBody(trackingOrderStatusUpdateSchema), postOrderStatusUpdate);
router.get('/eta/:orderId', getOrderEtaLive);

module.exports = router;
