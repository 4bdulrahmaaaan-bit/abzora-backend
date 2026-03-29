const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  listSavedCards,
  saveCard,
  deleteCard,
} = require('../controllers/cardController');

const router = express.Router();

router.use(authMiddleware);
router.get('/', listSavedCards);
router.post('/', saveCard);
router.delete('/:id', deleteCard);

module.exports = router;
