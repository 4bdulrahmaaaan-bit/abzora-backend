const mongoose = require('mongoose');
const { ensureAdmin } = require('./authController');

async function getSystemHealth(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;

    // Measure DB latency
    const startDb = Date.now();
    await mongoose.connection.db.admin().ping();
    const dbLatency = Date.now() - startDb;

    // System uptime from Node process
    const uptimeSeconds = process.uptime();

    // Mock API response times (In a real system, you'd use a middleware like prom-client)
    const apiP95 = 210; // ms
    const apiAvg = 145; // ms
    const errorRate = 0.4; // percent
    const successRate = 99.6; // percent

    // Define service health statuses based on thresholds
    const dbStatus = dbLatency < 100 ? 'healthy' : dbLatency < 500 ? 'warning' : 'critical';
    
    // Memory usage
    const memUsage = process.memoryUsage();
    const memTotal = memUsage.heapTotal / 1024 / 1024;
    const memUsed = memUsage.heapUsed / 1024 / 1024;

    res.status(200).json({
      success: true,
      data: {
        apiHealth: errorRate < 1 ? 'healthy' : 'warning',
        databaseHealth: dbStatus,
        firebaseHealth: 'healthy', // Mocked as Firebase is managed
        notificationHealth: 'healthy', // Mocked
        backgroundJobHealth: 'healthy', // Mocked
        storageHealth: 'healthy', // Mocked
        kpis: {
          uptimeSeconds,
          apiAvgLatencyMs: apiAvg,
          apiP95LatencyMs: apiP95,
          dbLatencyMs: dbLatency,
          errorRatePercent: errorRate,
          successRatePercent: successRate,
          memoryUsedMb: Math.round(memUsed),
          memoryTotalMb: Math.round(memTotal)
        }
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSystemHealth
};
