const NodeCache = require('node-cache');

// Standard TTL of 60 seconds as requested for dashboard APIs
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

module.exports = cache;
