const ALERT_TYPES = {
  STUCK_ORDER: 'STUCK_ORDER',
  DELAYED_ORDER: 'DELAYED_ORDER',
  RIDER_INACTIVE: 'RIDER_INACTIVE',
  DISPATCH_FAILED: 'DISPATCH_FAILED',
  ETA_RISK: 'ETA_RISK',
  VENDOR_DELAY: 'VENDOR_DELAY',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
};

const ALERT_SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

const SEVERITY_WEIGHT = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const TIMEOUTS_MINUTES = {
  vendorAccept: Number(process.env.OPS_TIMEOUT_VENDOR_ACCEPT_MIN || 8),
  riderAccept: Number(process.env.OPS_TIMEOUT_RIDER_ACCEPT_MIN || 7),
  pickup: Number(process.env.OPS_TIMEOUT_PICKUP_MIN || 25),
  delivery: Number(process.env.OPS_TIMEOUT_DELIVERY_MIN || 90),
};

const WORKER = {
  maxConcurrency: Math.max(1, Number(process.env.OPS_WORKER_CONCURRENCY || 4)),
  loopIntervalMs: Math.max(1000, Number(process.env.OPS_WORKER_LOOP_MS || 2000)),
  maxRetries: Math.min(3, Math.max(2, Number(process.env.OPS_ACTION_MAX_RETRIES || 3))),
};

module.exports = {
  ALERT_TYPES,
  ALERT_SEVERITY,
  SEVERITY_WEIGHT,
  TIMEOUTS_MINUTES,
  WORKER,
};
