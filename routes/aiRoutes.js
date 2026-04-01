const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  runAiGateway,
  recommendSize,
  getChatHistory,
  appendChatHistoryEntry,
  clearUserMemory,
  getSupportCache,
  setSupportCache,
  getTodayUsage,
  incrementTodayUsage,
  logAiUsage,
  listAiUsageLogs,
  listAiDailyStats,
  listUserAiUsageStats,
  logAiEvent,
} = require('../controllers/aiController');

const router = express.Router();

router.use(authMiddleware);
router.post('/gateway', runAiGateway);
router.post('/recommend-size', recommendSize);
router.get('/history/:chatId', getChatHistory);
router.post('/history/:chatId', appendChatHistoryEntry);
router.delete('/history', clearUserMemory);
router.get('/support-cache', getSupportCache);
router.post('/support-cache', setSupportCache);
router.get('/usage/today', getTodayUsage);
router.post('/usage/increment', incrementTodayUsage);
router.post('/usage/log', logAiUsage);
router.get('/usage/logs', listAiUsageLogs);
router.get('/usage/daily', listAiDailyStats);
router.get('/usage/users', listUserAiUsageStats);
router.post('/events', logAiEvent);

module.exports = router;
