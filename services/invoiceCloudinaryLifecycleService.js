const Invoice = require('../models/Invoice');

/**
 * Finds cloud assets that have invoice references missing required fields.
 * TODO: integrate Cloudinary Admin API search when outbound infra credentials are provisioned.
 */
async function scanInvoiceStorageAnomalies() {
  const recent = await Invoice.find({}).sort({ createdAt: -1 }).limit(500).select('invoiceNumber cloudinaryAsset versionLabel');
  const anomalies = [];
  recent.forEach((row) => {
    const asset = row.cloudinaryAsset || {};
    if (!asset.publicId || !asset.secureUrl) {
      anomalies.push({
        invoiceNumber: row.invoiceNumber,
        issue: 'missing_cloudinary_reference',
        versionLabel: row.versionLabel || 'v1',
      });
    }
    if (!asset.checksum) {
      anomalies.push({
        invoiceNumber: row.invoiceNumber,
        issue: 'missing_checksum',
        versionLabel: row.versionLabel || 'v1',
      });
    }
  });
  return {
    scanned: recent.length,
    anomalies,
    anomalyCount: anomalies.length,
  };
}

module.exports = {
  scanInvoiceStorageAnomalies,
};
