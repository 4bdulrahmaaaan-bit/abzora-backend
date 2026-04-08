const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createStore,
  getStore,
  getOwnStore,
  listRankedCustomStores,
  listStores,
  updateStore,
} = require('../controllers/storeController');

const router = express.Router();

router.get('/', listStores);
router.get('/custom/ranked', listRankedCustomStores);
router.get('/owner/me', authMiddleware, getOwnStore);
router.get('/:id', getStore);
router.post('/', authMiddleware, createStore);
router.put('/:id', authMiddleware, updateStore);

module.exports = router;
