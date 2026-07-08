function isTruthyEnv(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }
  return String(value).trim().toLowerCase() === 'true';
}

function enableLocalRiderDelivery() {
  return isTruthyEnv(process.env.ENABLE_LOCAL_RIDER_DELIVERY, false);
}

function isShiprocketEnabled() {
  return !enableLocalRiderDelivery();
}

function getShiprocketConfig() {
  return {
    email: process.env.SHIPROCKET_EMAIL || '',
    password: process.env.SHIPROCKET_PASSWORD || '',
    channelId: process.env.SHIPROCKET_CHANNEL_ID || '',
    webhookSecret: process.env.SHIPROCKET_WEBHOOK_SECRET || '',
  };
}

module.exports = {
  enableLocalRiderDelivery,
  isShiprocketEnabled,
  getShiprocketConfig,
};
