const state = {
  counters: new Map(),
  hist: new Map(),
};

function key(name, labels = {}) {
  const sorted = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${String(labels[k])}`)
    .join(',');
  return `${name}|${sorted}`;
}

function inc(name, value = 1, labels = {}) {
  const k = key(name, labels);
  state.counters.set(k, Number(state.counters.get(k) || 0) + Number(value || 0));
}

function observe(name, value, labels = {}) {
  const k = key(name, labels);
  const prev = state.hist.get(k) || { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: 0 };
  const v = Number(value || 0);
  prev.count += 1;
  prev.sum += v;
  prev.min = Math.min(prev.min, v);
  prev.max = Math.max(prev.max, v);
  state.hist.set(k, prev);
}

function snapshot() {
  const counters = {};
  const histograms = {};
  for (const [k, v] of state.counters.entries()) counters[k] = v;
  for (const [k, v] of state.hist.entries()) {
    histograms[k] = {
      count: v.count,
      sum: Number(v.sum.toFixed(3)),
      avg: v.count > 0 ? Number((v.sum / v.count).toFixed(3)) : 0,
      min: Number.isFinite(v.min) ? Number(v.min.toFixed(3)) : 0,
      max: Number(v.max.toFixed(3)),
    };
  }
  return { counters, histograms };
}

module.exports = {
  inc,
  observe,
  snapshot,
};

