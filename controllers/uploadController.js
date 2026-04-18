const cloudinary = require('../config/cloudinary');

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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

async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Image file is required.' });
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(req.file.mimetype || '')) {
      return res.status(400).json({ success: false, message: 'Only image files can be uploaded.' });
    }
    const detectedMimeType = detectImageType(req.file.buffer);
    if (!detectedMimeType || detectedMimeType !== req.file.mimetype) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or unsafe image upload rejected.',
      });
    }

    const folder = process.env.CLOUDINARY_FOLDER || 'abzora';
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
