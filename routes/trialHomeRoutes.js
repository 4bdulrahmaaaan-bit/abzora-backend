const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  bookTrialHome,
  requestTrialHome,
  listMyTrialHomeSessions,
  getTrialHomeSession,
  updateTrialHomeSession,
  cancelTrialHome,
  saveTrialHomeFeedback,
  convertTrialHomeSessionToOrder,
  convertTrialHomeSessionToTailoring,
  approveTrialHome,
  rejectTrialHome,
} = require('../controllers/trialHomeController');

const router = express.Router();

router.get('/me', authMiddleware, listMyTrialHomeSessions);
router.post('/request', authMiddleware, requestTrialHome);
router.post('/book', authMiddleware, bookTrialHome);
router.get('/:id', authMiddleware, getTrialHomeSession);
router.patch('/:id/modify', authMiddleware, updateTrialHomeSession);
router.patch('/:id/cancel', authMiddleware, cancelTrialHome);
router.post('/:id/fit-feedback', authMiddleware, saveTrialHomeFeedback);
router.post('/:id/convert-to-order', authMiddleware, convertTrialHomeSessionToOrder);
router.post('/:id/convert-to-tailoring', authMiddleware, convertTrialHomeSessionToTailoring);
router.post('/:id/approve', authMiddleware, approveTrialHome);
router.post('/:id/reject', authMiddleware, rejectTrialHome);

module.exports = router;
