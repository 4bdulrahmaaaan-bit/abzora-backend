const cloudinary = require('../config/cloudinary');

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
    if (!req.file.mimetype?.startsWith('image/')) {
      return res.status(400).json({ success: false, message: 'Only image files can be uploaded.' });
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
