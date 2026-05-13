const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  createPaymentOrderSchema,
  verifyPaymentSchema,
} = require('../validation/schemas/mutationSchemas');
const {
  createPaymentOrder,
  verifyPaymentSignature,
} = require('../controllers/paymentController');

const router = express.Router();

router.use(authMiddleware);
router.post('/create-order', validateBody(createPaymentOrderSchema), createPaymentOrder);
router.post('/verify', validateBody(verifyPaymentSchema), verifyPaymentSignature);

module.exports = router;
