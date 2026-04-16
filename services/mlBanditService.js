const crypto = require('crypto');

const MLBanditState = require('../models/MLBanditState');

const ACTIONS = ['BUY_NOW', 'TRY_HOME', 'HYBRID'];
const FEATURE_KEYS = [
  'fitConfidence',
  'returnRate',
  'sessionDepth',
  'sameDayAvailable',
  'productFitRisk',
  'userTypeNew',
];

const CACHE_TTL_MS = 30 * 1000;
let stateCache = null;
let stateCacheTime = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeFeatures(input = {}) {
  const fitConfidence = clamp(Number(input.fitConfidence) || 0, 0, 100) / 100;
  const returnRate = clamp(Number(input.returnRate) || 0, 0, 100) / 100;
  const sessionDepth = clamp(Number(input.sessionDepth) || 1, 1, 20) / 10;
  const sameDayAvailable = input.sameDayAvailable ? 1 : 0;
  const productFitRisk = clamp(Number(input.productFitRisk) || 0, 0, 1);
  const userTypeNew = String(input.userType || '').toLowerCase() === 'new' ? 1 : 0;

  return {
    fitConfidence,
    returnRate,
    sessionDepth,
    sameDayAvailable,
    productFitRisk,
    userTypeNew,
  };
}

function dotScore(state, features) {
  const weights = state.weights || {};
  let score = Number(state.bias) || 0;
  for (const key of FEATURE_KEYS) {
    score += (Number(weights[key]) || 0) * (Number(features[key]) || 0);
  }
  return score;
}

function seededRandom(seed) {
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  const value = parseInt(digest.slice(0, 12), 16);
  return (value % 1000000) / 1000000;
}

async function ensureActionStates() {
  await Promise.all(
    ACTIONS.map((action) =>
      MLBanditState.updateOne(
        { action },
        {
          $setOnInsert: {
            action,
            pulls: 0,
            totalReward: 0,
            avgReward: 0,
            bias: 0,
            weights: FEATURE_KEYS.reduce((map, key) => ({ ...map, [key]: 0 }), {}),
          },
        },
        { upsert: true },
      ),
    ),
  );
}

async function getStates() {
  const now = Date.now();
  if (stateCache && now - stateCacheTime < CACHE_TTL_MS) {
    return stateCache;
  }

  await ensureActionStates();
  const states = await MLBanditState.find({ action: { $in: ACTIONS } }).lean();
  const map = new Map(states.map((state) => [state.action, state]));
  stateCache = ACTIONS.map((action) => map.get(action)).filter(Boolean);
  stateCacheTime = now;
  return stateCache;
}

async function decideAction({
  features,
  epsilon = 0.15,
  seed = '',
  preferredAction = '',
}) {
  const normalized = normalizeFeatures(features);
  const states = await getStates();
  const scored = states.map((state) => ({
    action: state.action,
    score: dotScore(state, normalized),
    pulls: state.pulls || 0,
    avgReward: state.avgReward || 0,
  }));

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const randomRoll = seededRandom(seed || `${Date.now()}:${Math.random()}`);
  const shouldExplore = randomRoll < clamp(Number(epsilon) || 0, 0, 1);
  let chosenAction;

  if (shouldExplore) {
    const index = Math.floor(randomRoll * ACTIONS.length) % ACTIONS.length;
    chosenAction = ACTIONS[index];
  } else if (preferredAction && ACTIONS.includes(preferredAction)) {
    chosenAction = preferredAction;
  } else {
    chosenAction = sorted[0]?.action || 'BUY_NOW';
  }

  return {
    action: chosenAction,
    exploration: shouldExplore,
    scores: scored,
    features: normalized,
  };
}

async function updateReward({
  action,
  reward,
  features,
  learningRate = 0.08,
  exploration = false,
}) {
  const normalizedAction = String(action || '').trim().toUpperCase();
  if (!ACTIONS.includes(normalizedAction)) {
    throw new Error('Invalid action for reward update.');
  }

  const normalizedReward = clamp(Number(reward) || 0, 0, 1);
  const normalizedFeatures = normalizeFeatures(features);
  const state = await MLBanditState.findOne({ action: normalizedAction });
  if (!state) {
    throw new Error('Bandit action state not found.');
  }

  const weights = Object.fromEntries(FEATURE_KEYS.map((key) => [key, Number(state.weights?.get?.(key) ?? state.weights?.[key] ?? 0)]));
  const prediction = dotScore(
    { bias: state.bias, weights },
    normalizedFeatures,
  );
  const error = normalizedReward - prediction;
  const lr = clamp(Number(learningRate) || 0.08, 0.0001, 1);

  state.bias = (Number(state.bias) || 0) + lr * error;
  for (const key of FEATURE_KEYS) {
    weights[key] = (weights[key] || 0) + lr * error * (normalizedFeatures[key] || 0);
  }
  state.weights = weights;
  state.pulls = (state.pulls || 0) + 1;
  state.totalReward = (state.totalReward || 0) + normalizedReward;
  state.avgReward = state.pulls > 0 ? state.totalReward / state.pulls : 0;
  state.lastUpdatedAt = new Date();
  if (exploration) {
    state.explorationCount = (state.explorationCount || 0) + 1;
  }

  await state.save();
  stateCache = null;

  return {
    action: normalizedAction,
    pulls: state.pulls,
    avgReward: state.avgReward,
    lastUpdatedAt: state.lastUpdatedAt,
  };
}

module.exports = {
  ACTIONS,
  decideAction,
  normalizeFeatures,
  updateReward,
};
