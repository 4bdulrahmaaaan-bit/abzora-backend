const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const { validateQuery } = require('../validation/schemaValidator');
const { adminInvoiceQuerySchema } = require('../validation/schemas/invoiceSchemas');
const { listAdminInvoices } = require('../controllers/invoiceController');

const router = express.Router();
router.use(authMiddleware, requireAdmin);
router.get('/invoices', validateQuery(adminInvoiceQuerySchema), listAdminInvoices);

module.exports = router;
