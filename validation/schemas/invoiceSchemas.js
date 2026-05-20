const adminInvoiceQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paymentStatus: { type: 'string', maxLength: 30 },
    status: { type: 'string', maxLength: 40 },
    customerId: { type: 'string', maxLength: 128 },
    vendorId: { type: 'string', maxLength: 128 },
    orderId: { type: 'string', maxLength: 128 },
    dateFrom: { type: 'string' },
    dateTo: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 300 },
    page: { type: 'integer', minimum: 1, maximum: 10000 },
  },
};

const emailLogQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', maxLength: 20 },
    invoiceId: { type: 'string', maxLength: 128 },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
  },
};

module.exports = {
  adminInvoiceQuerySchema,
  emailLogQuerySchema,
};
