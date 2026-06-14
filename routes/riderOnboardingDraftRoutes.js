const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware'); // Assuming this exists based on common patterns
const {
  saveDraft,
  getDraft,
  deleteDraft,
  updateStep,
} = require('../controllers/riderOnboardingDraftController');

// All routes here are protected by authMiddleware
router.use(authMiddleware);

router.post('/', saveDraft);
router.get('/', getDraft);
router.delete('/', deleteDraft);
router.patch('/step', updateStep);

module.exports = router;
