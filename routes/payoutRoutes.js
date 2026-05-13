const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const { rejectRequestSchema } = require('../validation/schemas/mutationSchemas');
const {
  settleVendorPayouts,
  settleRiderPayouts,
  approvePendingWithdrawal,
  rejectPendingWithdrawal,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.post('/vendor/settle', validateBody({ type: 'object', additionalProperties: false, properties: { storeId: { type: 'string', minLength: 1, maxLength: 100 }, periodLabel: { type: 'string', minLength: 1, maxLength: 120 } } }), settleVendorPayouts);
router.post('/rider/settle', validateBody({ type: 'object', additionalProperties: false, properties: { riderId: { type: 'string', minLength: 1, maxLength: 100 }, periodLabel: { type: 'string', minLength: 1, maxLength: 120 } } }), settleRiderPayouts);
router.post('/withdrawals/:requestId/approve', approvePendingWithdrawal);
router.post('/withdrawals/:requestId/reject', validateBody(rejectRequestSchema), rejectPendingWithdrawal);

module.exports = router;
