const cloudinary = require('../config/cloudinary');

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);
const ALLOWED_UPLOAD_ROOTS = new Set([
  'product_images',
  'user_profiles',
  'store_logos',
  'store_banners',
  'homepage_banners',
  'category_icons',
  'vendor_kyc_owner',
  'vendor_kyc_store',
  'vendor_kyc_docs',
  'vendor_kyc_selfie',
  'rider_kyc_profile',
  'rider_kyc_docs',
  'onboarding-drafts/portfolio',
  'onboarding-drafts/kyc',
]);

function matchesMagicBytes(buffer, signatures) {
  return signatures.some((signature) => buffer.subarray(0, signature.length).equals(signature));
}

function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) {
    return '';
  }
  if (matchesMagicBytes(buffer, [Buffer.from([0xff, 0xd8, 0xff])])) {
    return 'image/jpeg';
  }
  if (matchesMagicBytes(buffer, [Buffer.from([0x89, 0x50, 0x4e, 0x47])])) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (matchesMagicBytes(buffer, [Buffer.from('GIF87a'), Buffer.from('GIF89a')])) {
    return 'image/gif';
  }
  return '';
}

function uploadBuffer(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        return resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

function isSafePathSegment(value) {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function resolveUploadFolder(rawFolder) {
  const folder = String(rawFolder || '').trim();
  if (!folder) {
    throw new Error('Upload folder is required.');
  }

  const segments = folder.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2 || segments.length > 3) {
    throw new Error('Invalid upload folder.');
  }

  const root = segments.length === 3
    ? `${segments[0]}/${segments[1]}`
    : segments[0];
  const ownerId = segments[segments.length - 1];
  if (!ALLOWED_UPLOAD_ROOTS.has(root) || !isSafePathSegment(ownerId)) {
    throw new Error('Invalid upload folder.');
  }

  return `${root}/${ownerId}`;
}

async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image file is required.' });
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(req.file.mimetype || '')) {
      return res.status(400).json({ success: false, message: 'Only image files can be uploaded.' });
    }
    const mimeType = String(req.file.mimetype || '').toLowerCase();
    const detectedMimeType = detectImageType(req.file.buffer);
    const skipMagicByteCheck = mimeType === 'image/heic' || mimeType === 'image/heif';
    if (!skipMagicByteCheck && (!detectedMimeType || detectedMimeType !== mimeType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or unsafe image upload rejected.',
      });
    }

    const baseFolder = process.env.CLOUDINARY_FOLDER || 'abianzo';
    const normalizedFolder = resolveUploadFolder(req.body.folder);
    const subFolder = `/${normalizedFolder}`;
    const folder = `${baseFolder}${subFolder}`;
    const result = await uploadBuffer(req.file.buffer, folder);

    return res.status(200).json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  uploadImage,
};
