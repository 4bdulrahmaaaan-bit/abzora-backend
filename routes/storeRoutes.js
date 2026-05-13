const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireRoles } = require('../middleware/authorizationMiddleware');
const { validateQuery } = require('../validation/schemaValidator');
const { storeListQuerySchema } = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  createStore,
  getStore,
  getStoreByOwner,
  getOwnStore,
  listRankedCustomStores,
  listStores,
  updateStore,
} = require('../controllers/storeController');

const router = express.Router();

router.get('/', validateQuery(storeListQuerySchema), listStores);
router.get('/custom/ranked', listRankedCustomStores);
router.get('/owner/me', authMiddleware, getOwnStore);
router.get('/owner/:ownerId', authMiddleware, requireRoles('vendor', 'rider', 'admin', 'super_admin'), getStoreByOwner);
router.get('/:id', getStore);
router.post('/', authMiddleware, createStore);
router.put('/:id', authMiddleware, updateStore);

module.exports = router;
