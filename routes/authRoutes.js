const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  me,
  debugAuth,
  upsertTestUser,
  syncProfile,
  listAddresses,
  saveAddress,
  deleteAddress,
  getMemory,
  saveMemory,
} = require('../controllers/authController');

const router = express.Router();

router.post('/test-user', upsertTestUser);
router.get('/me', authMiddleware, me);
router.get('/debug', authMiddleware, debugAuth);
router.post('/sync-profile', authMiddleware, syncProfile);
router.get('/addresses', authMiddleware, listAddresses);
router.post('/addresses', authMiddleware, saveAddress);
router.delete('/addresses/:id', authMiddleware, deleteAddress);
router.get('/memory', authMiddleware, getMemory);
router.put('/memory', authMiddleware, saveMemory);

module.exports = router;
