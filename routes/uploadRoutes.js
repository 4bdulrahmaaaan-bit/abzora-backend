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
    if (!file.mimetype?.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed.'));
      return;
    }
    cb(null, true);
  },
});

router.post('/', authMiddleware, upload.single('image'), uploadImage);

module.exports = router;
