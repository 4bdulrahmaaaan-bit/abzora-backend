const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

function testDeploymentSafety() {
  const api = read('deploy/k8s/base/deployment-api.yaml');
  const worker = read('deploy/k8s/base/deployment-worker.yaml');
  const ws = read('deploy/k8s/base/deployment-websocket.yaml');
  const all = `${api}\n${worker}\n${ws}`;

  assert(all.includes('readinessProbe:'), 'deployments must define readinessProbe');
  assert(all.includes('livenessProbe:'), 'deployments must define livenessProbe');
  assert(all.includes('resources:'), 'deployments must define resources');
  assert(all.includes('requests:'), 'deployments must define resource requests');
  assert(all.includes('limits:'), 'deployments must define resource limits');
  assert(api.includes('maxUnavailable: 0'), 'api rollout must be zero-downtime safe');
}

function testAutoscalingSafety() {
  const hpa = read('deploy/k8s/base/hpa.yaml');
  assert(hpa.includes('name: cpu'), 'hpa must include cpu scaling metric');
  assert(hpa.includes('name: memory'), 'hpa must include memory scaling metric');
  assert(hpa.includes('http_request_latency_p95_ms'), 'hpa must include request latency scaling metric');
  assert(hpa.includes('queue_lag_seconds'), 'hpa must include queue lag scaling metric');
}

function testTopologyAndDisruptionSafety() {
  const api = read('deploy/k8s/base/deployment-api.yaml');
  const pdb = read('deploy/k8s/base/pdb.yaml');
  assert(api.includes('podAntiAffinity'), 'api deployment must include anti-affinity');
  assert(api.includes('topologySpreadConstraints'), 'api deployment must include topology spread constraints');
  assert(pdb.includes('PodDisruptionBudget'), 'pdb manifests must exist');
}

function testReadinessEndpointWiring() {
  const serverJs = read('backend/server.js');
  assert(serverJs.includes('/health/ready'), 'server readiness endpoint must exist');
  assert(serverJs.includes('/health/live'), 'server liveness endpoint must exist');
}

function run() {
  testDeploymentSafety();
  testAutoscalingSafety();
  testTopologyAndDisruptionSafety();
  testReadinessEndpointWiring();
  // eslint-disable-next-line no-console
  console.log('k8s-manifests-safety tests passed');
}

try {
  run();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('k8s-manifests-safety tests failed:', error);
  process.exitCode = 1;
}
