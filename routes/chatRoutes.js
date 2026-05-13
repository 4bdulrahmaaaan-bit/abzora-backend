const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const { chatSendMessageSchema } = require('../validation/schemas/customerSchemas');
const {
  listChats,
  listMessages,
  sendMessage,
} = require('../controllers/chatController');

const router = express.Router();

router.use(authMiddleware);
router.get('/', listChats);
router.get('/:id/messages', listMessages);
router.post('/:id/messages', validateBody(chatSendMessageSchema), sendMessage);

module.exports = router;
