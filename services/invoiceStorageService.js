const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INVOICE_DIR = path.join(__dirname, '..', 'storage', 'invoices');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function monthFolder(date) {
  const d = new Date(date || Date.now());
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return { year, month, folder: `Abianzo/invoices/${year}/${month}` };
}

async function uploadCloudinaryRaw({ invoiceNumber, versionLabel, pdfBuffer, metadata = {}, tags = [] }) {
  const { folder } = monthFolder();
  const checksum = sha256(pdfBuffer);
  const publicId = `${folder}/${invoiceNumber}-${versionLabel}`;
  const uploadOptions = {
    resource_type: 'raw',
    type: 'authenticated',
    public_id: publicId,
    overwrite: false,
    invalidate: false,
    tags: ['abzora', 'invoice', ...tags],
    context: Object.entries({
      invoiceNumber,
      versionLabel,
      checksum,
      ...metadata,
    }).map(([k, v]) => `${k}=${String(v).slice(0, 200)}`),
  };

  const result = await cloudinary.uploader.upload(`data:application/pdf;base64,${pdfBuffer.toString('base64')}`, uploadOptions);
  return {
    provider: 'cloudinary',
    url: result.secure_url,
    publicId: result.public_id,
    secureUrl: result.secure_url,
    version: Number(result.version || 1),
    bytes: Number(result.bytes || 0),
    checksum,
    resourceType: 'raw',
    type: 'authenticated',
    folder,
    tags: uploadOptions.tags,
    metadata,
  };
}

async function savePdf({ invoiceNumber, versionLabel = 'v1', pdfBuffer, metadata = {}, tags = [] }) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });
  const filePath = path.join(INVOICE_DIR, `${invoiceNumber}-${versionLabel}.pdf`);
  fs.writeFileSync(filePath, pdfBuffer);

  const provider = (process.env.INVOICE_STORAGE_PROVIDER || 'local').trim().toLowerCase();
  if (provider === 'cloudinary') {
    try {
      const cloud = await uploadCloudinaryRaw({ invoiceNumber, versionLabel, pdfBuffer, metadata, tags });
      return { ...cloud, filePath };
    } catch (error) {
      return {
        provider: 'local_fallback',
        url: `/files/invoices/${path.basename(filePath)}`,
        filePath,
        checksum: sha256(pdfBuffer),
        warning: String(error.message || error),
      };
    }
  }

  return {
    provider: 'local',
    url: `/files/invoices/${path.basename(filePath)}`,
    filePath,
    checksum: sha256(pdfBuffer),
  };
}

function resolvePdfPath(invoiceNumber, versionLabel = 'v1') {
  return path.join(INVOICE_DIR, `${invoiceNumber}-${versionLabel}.pdf`);
}

function buildCloudinarySignedUrl({ publicId, expiresInSeconds = 600 }) {
  if (!publicId) return '';
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return cloudinary.utils.private_download_url(publicId, 'pdf', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: expiresAt,
    attachment: false,
  });
}

module.exports = {
  savePdf,
  resolvePdfPath,
  buildCloudinarySignedUrl,
};
