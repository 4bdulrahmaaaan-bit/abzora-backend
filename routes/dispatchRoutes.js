const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const {
  dispatchAssign,
  dispatchBatchAssign,
  getOrderEta,
  listDispatchBatches,
  triggerDispatchRebalance,
  getSlaOverview,
} = require('../controllers/dispatchController');

const { enableLocalRiderDelivery } = require('../services/deliveryModeService');

const router = express.Router();

router.use((req, res, next) => {
  if (!enableLocalRiderDelivery()) {
    return res.status(403).json({ success: false, message: 'Local rider delivery is disabled.' });
  }
  next();
});


router.use(authMiddleware, requireAdmin);

router.post('/assign', dispatchAssign);
router.post('/batch-assign', dispatchBatchAssign);
router.get('/batches', listDispatchBatches);
router.post('/rebalance', triggerDispatchRebalance);
router.get('/sla', getSlaOverview);
router.get('/eta/:orderId', getOrderEta);

module.exports = router;
