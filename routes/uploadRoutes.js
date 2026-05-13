const express = require('express');
const multer = require('multer');

const authMiddleware = require('../middleware/authMiddleware');
const { uploadImage } = require('../controllers/uploadController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed.'));
      return;
    }
    if (mime === 'image/svg+xml') {
      cb(new Error('SVG uploads are not allowed.'));
      return;
    }
    cb(null, true);
  },
});

router.post('/', authMiddleware, (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Image exceeds 5MB size limit.' });
      }
      return res.status(400).json({ success: false, message: error.message || 'Invalid upload payload.' });
    }
    return res.status(400).json({ success: false, message: error.message || 'Invalid upload payload.' });
  });
}, uploadImage);

module.exports = router;
