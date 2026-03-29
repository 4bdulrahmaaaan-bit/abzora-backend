const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
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
router.get('/chats', listSupportChats);
router.post('/chats', createSupportChat);
router.get('/chats/:id', getSupportChat);
router.get('/chats/:id/messages', listSupportMessages);
router.post('/chats/:id/messages', sendSupportMessage);
router.post('/chats/:id/read', markSupportChatRead);
router.post('/chats/:id/close', closeSupportChat);
router.post('/chats/:id/reopen', reopenSupportChat);

module.exports = router;
