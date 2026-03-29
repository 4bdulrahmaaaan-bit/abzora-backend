const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createStore,
  getStore,
  getOwnStore,
  listStores,
  updateStore,
} = require('../controllers/storeController');

const router = express.Router();

router.get('/', listStores);
router.get('/owner/me', authMiddleware, getOwnStore);
router.get('/:id', getStore);
router.post('/', authMiddleware, createStore);
router.put('/:id', authMiddleware, updateStore);

module.exports = router;
