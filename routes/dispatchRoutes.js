const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  dispatchAssign,
  dispatchBatchAssign,
  getOrderEta,
  listDispatchBatches,
  triggerDispatchRebalance,
  getSlaOverview,
} = require('../controllers/dispatchController');

const router = express.Router();

router.use(authMiddleware);

router.post('/assign', dispatchAssign);
router.post('/batch-assign', dispatchBatchAssign);
router.get('/batches', listDispatchBatches);
router.post('/rebalance', triggerDispatchRebalance);
router.get('/sla', getSlaOverview);
router.get('/eta/:orderId', getOrderEta);

module.exports = router;
