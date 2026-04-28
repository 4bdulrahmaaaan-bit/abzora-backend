const DEFAULT_MEASUREMENT_KEYS = ['chestCm', 'waistCm', 'hipCm', 'shoulderCm', 'inseamCm'];

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const CATEGORY_BASE_SIZE_CHART = {
  shirt: { chestCm: 100, waistCm: 92, shoulderCm: 44 },
  't-shirt': { chestCm: 102, waistCm: 96, shoulderCm: 45 },
  kurta: { chestCm: 104, waistCm: 98, shoulderCm: 45 },
  jacket: { chestCm: 106, waistCm: 100, shoulderCm: 46 },
  pants: { waistCm: 86, hipCm: 102, inseamCm: 79 },
};

const FIT_ADJUSTMENTS = {
  slim: -2,
  regular: 0,
  relaxed: 2,
  oversized: 4,
  athletic: 1,
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeMeasurements(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key.toString().trim(), Number(value)])
      .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
  );
}

function categorySizeChart(category = '', fitPreset = 'regular') {
  const base = CATEGORY_BASE_SIZE_CHART[category] || CATEGORY_BASE_SIZE_CHART.shirt;
  const adjustment = FIT_ADJUSTMENTS[fitPreset] ?? 0;
  return SIZE_ORDER.reduce((accumulator, size, index) => {
    const grade = (index - 2) * 4;
    accumulator[size] = Object.fromEntries(
      Object.entries(base).map(([key, value]) => [key, value + grade + adjustment])
    );
    return accumulator;
  }, {});
}

function measurementCoverage(userMeasurements, targetMeasurements) {
  const keys = DEFAULT_MEASUREMENT_KEYS.filter(
    (key) => Number.isFinite(userMeasurements[key]) && Number.isFinite(targetMeasurements[key])
  );
  return keys;
}

function calculateSizeError(userMeasurements, targetMeasurements) {
  const keys = measurementCoverage(userMeasurements, targetMeasurements);
  if (!keys.length) {
    return { normalizedError: 0.35, usedKeys: [] };
  }
  const absolutePercentErrors = keys.map((key) => {
    const expected = targetMeasurements[key];
    const actual = userMeasurements[key];
    return Math.abs(actual - expected) / Math.max(expected, 1);
  });
  const averageError =
    absolutePercentErrors.reduce((sum, item) => sum + item, 0) / absolutePercentErrors.length;
  return {
    normalizedError: averageError,
    usedKeys: keys,
  };
}

function bestSizeByMeasurements(userMeasurements, sizeChart) {
  const ranked = Object.entries(sizeChart).map(([size, spec]) => {
    const { normalizedError, usedKeys } = calculateSizeError(userMeasurements, spec);
    return { size, normalizedError, usedKeys };
  });
  ranked.sort((left, right) => left.normalizedError - right.normalizedError);
  return ranked[0] || { size: 'M', normalizedError: 0.35, usedKeys: [] };
}

function fitLabel(score) {
  if (score >= 92) {
    return 'Excellent fit';
  }
  if (score >= 84) {
    return 'Great fit';
  }
  if (score >= 72) {
    return 'Good fit';
  }
  return 'Needs adjustment';
}

function evaluateFit({
  category = 'shirt',
  fitPreset = 'regular',
  userMeasurements = {},
  sizeChart = {},
}) {
  const normalizedUser = normalizeMeasurements(userMeasurements);
  const normalizedFit = fitPreset?.toString().trim().toLowerCase() || 'regular';
  const effectiveChart =
    sizeChart && typeof sizeChart === 'object' && !Array.isArray(sizeChart) && Object.keys(sizeChart).length
      ? sizeChart
      : categorySizeChart(category, normalizedFit);
  const best = bestSizeByMeasurements(normalizedUser, effectiveChart);
  const confidencePenalty = clamp(best.normalizedError * 110, 5, 55);
  const score = clamp(Math.round(100 - confidencePenalty), 45, 99);

  return {
    recommendedSize: best.size,
    fitScore: score,
    fitLabel: fitLabel(score),
    confidence: clamp(Number((1 - best.normalizedError).toFixed(3)), 0.4, 0.98),
    usedMeasurements: best.usedKeys,
    effectiveSizeChart: effectiveChart,
  };
}

module.exports = {
  evaluateFit,
};
