const { generatePremiumInvoicePdf } = require('./invoicePdfService');

let QRCode;
try {
  // optional dependency
  QRCode = require('qrcode');
} catch (_) {
  QRCode = null;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

async function generateInvoicePdf({ invoice, order, customer, store }) {
  const qrPayload = {
    invoiceNumber: invoice.invoiceNumber,
    orderId: String(order._id || ''),
    amount: invoice.grandTotal,
    generatedAt: invoice.generatedAt,
  };
  let qrDataUrl = '';
  if (QRCode) {
    qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), { margin: 1, width: 140 });
  }

  const invoiceInput = {
    orderId: String(order._id || ''),
    invoiceDate: new Date(invoice.generatedAt || Date.now()).toISOString().slice(0, 10),
    customerName: customer?.name || invoice.shippingAddress?.name || 'Abianzo Customer',
    customerAddressLine1: invoice.billingAddress?.addressLine1 || invoice.shippingAddress?.addressLine1 || '-',
    customerAddressLine2: invoice.billingAddress?.addressLine2 || '-',
    customerCity: invoice.billingAddress?.city || '-',
    customerState: invoice.billingAddress?.state || '-',
    customerPostalCode: invoice.billingAddress?.pincode || '-',
    customerCountry: 'India',
    customerPhone: invoice.billingAddress?.phone || customer?.phone || '-',
    deliveryEstimatedDate: order?.trackingTimestamps?.Delivered || '-',
    deliveryMethod: 'Abianzo Express',
    deliveryTrackingId: order?.trackingId || '-',
    deliveryAddress: [
      invoice.shippingAddress?.addressLine1,
      invoice.shippingAddress?.addressLine2,
      invoice.shippingAddress?.city,
      invoice.shippingAddress?.state,
      invoice.shippingAddress?.pincode,
    ].filter(Boolean).join(', '),
    marketplaceItems: (invoice.items || []).map((item) => ({
      name: `${item.name} (HSN: ${item.hsnSac || 'NA'})`,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
      size: '',
    })),
    customTailoringItems: [],
    subtotal: invoice.subtotal,
    taxLabel: `GST (CGST ${money(invoice.cgst)} + SGST ${money(invoice.sgst)} + IGST ${money(invoice.igst)})`,
    taxAmount: invoice.tax,
    grandTotal: invoice.grandTotal,
    paymentMethod: `${invoice.paymentMethod || 'N/A'}${invoice.walletAmount ? ` + Wallet INR ${money(invoice.walletAmount)}` : ''}`,
    paymentStatus: invoice.paymentStatus,
    transactionId: order?.razorpay?.paymentId || order?.razorpay?.orderId || invoice.upiReference || '-',
    vendorName: store?.name || 'Abianzo Partner Store',
    vendorAddress: [store?.address, store?.city, store?.state].filter(Boolean).join(', '),
    vendorTaxId: store?.gstin || process.env.ABZORA_GSTIN || 'N/A',
    vendorContact: store?.phone || '-',
    stylePersona: 'Premium Ecommerce Invoice',
    preferredSilhouette: `Invoice ${invoice.invoiceNumber}`,
    occasionIntent: qrDataUrl
      ? `Verify: ${(process.env.PUBLIC_BACKEND_URL || 'https://abzora.in')}/verify/invoice/${invoice._id}`
      : 'QR unavailable',
    craftedForYouMessage: `Abianzo GST Invoice (${invoice.versionLabel || 'v1'}). Snapshot hash: ${invoice.signedHash}`,
    personalizationDetails: `Delivery Charge INR ${money(invoice.shippingCharge)} | Discount INR ${money(invoice.discount)}`,
  };

  const { pdfBuffer } = await generatePremiumInvoicePdf(invoiceInput);
  return {
    pdfBuffer,
    qrPayload: JSON.stringify(qrPayload),
  };
}

module.exports = {
  generateInvoicePdf,
};
