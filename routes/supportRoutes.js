const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  emptyBodySchema,
  supportCreateChatSchema,
  supportListQuerySchema,
  supportMessagesQuerySchema,
  supportSendMessageSchema,
} = require('../validation/schemas/customerSchemas');
const {
  listSupportChats,
  getSupportChat,
  listSupportMessages,
  createSupportChat,
  sendSupportMessage,
  markSupportChatRead,
  closeSupportChat,
  reopenSupportChat,
} = require('../controllers/supportController');

const router = express.Router();

router.use(authMiddleware);
router.get('/chats', validateQuery(supportListQuerySchema), listSupportChats);
router.post('/chats', validateBody(supportCreateChatSchema), createSupportChat);
router.get('/chats/:id', getSupportChat);
router.get('/chats/:id/messages', validateQuery(supportMessagesQuerySchema), listSupportMessages);
router.post('/chats/:id/messages', validateBody(supportSendMessageSchema), sendSupportMessage);
router.post('/chats/:id/read', validateBody(emptyBodySchema), markSupportChatRead);
router.post('/chats/:id/close', validateBody(emptyBodySchema), closeSupportChat);
router.post('/chats/:id/reopen', validateBody(emptyBodySchema), reopenSupportChat);

module.exports = router;
