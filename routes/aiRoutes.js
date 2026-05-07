const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  runAiGateway,
  recommendSize,
  stylistChat,
  stylistRecommendations,
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
  generateProductSpecs,
  getProductSpecConfig,
} = require('../controllers/aiController');
const { scoreTrialRisk } = require('../controllers/aiRiskController');

const router = express.Router();

router.use(authMiddleware);
router.post('/gateway', runAiGateway);
router.post('/recommend-size', recommendSize);
router.post('/stylist-chat', stylistChat);
router.post('/style', stylistRecommendations);
router.post('/stylist-recommendations', stylistRecommendations);
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
router.get('/specs/config', getProductSpecConfig);
router.post('/specs', generateProductSpecs);
router.post('/risk-score', scoreTrialRisk);

module.exports = router;
