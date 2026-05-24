const DEFAULT_POLICY = {
  maxModelBytesByTier: {
    low: 4 * 1024 * 1024,
    mid: 8 * 1024 * 1024,
    flagship: 14 * 1024 * 1024,
    premium_lidar: 20 * 1024 * 1024,
  },
  maxTextureBytesByTier: {
    low: 2 * 1024 * 1024,
    mid: 4 * 1024 * 1024,
    flagship: 8 * 1024 * 1024,
    premium_lidar: 12 * 1024 * 1024,
  },
  maxTriangleEstimateByTier: {
    low: 18000,
    mid: 32000,
    flagship: 52000,
    premium_lidar: 76000,
  },
  minQualityScore: 0.7,
};

function getGarmentQualityPolicy() {
  return DEFAULT_POLICY;
}

module.exports = {
  getGarmentQualityPolicy,
};
