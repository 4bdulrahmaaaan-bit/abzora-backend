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

function testIngressTrafficSafety() {
  const ingress = read('deploy/k8s/base/ingress.yaml');
  assert(ingress.includes('name: abzora-api-ingress'), 'api ingress must exist');
  assert(ingress.includes('name: abzora-websocket-ingress'), 'websocket ingress must exist');
  assert(ingress.includes('name: abzora-admin-ingress'), 'admin ingress must exist');
  assert(ingress.includes('name: abzora-webhook-ingress'), 'webhook ingress must exist');
  assert(ingress.includes('force-ssl-redirect: "true"'), 'ingress must enforce TLS redirect');
  assert(ingress.includes('ssl-redirect: "true"'), 'ingress must enforce SSL redirect');
  assert(ingress.includes('limit-rps:'), 'ingress must define rate limiting');
  assert(ingress.includes('limit-connections:'), 'ingress must define connection limiting');
  assert(ingress.includes('load-balance: least_conn'), 'ingress must use least_conn balancing policy');
  assert(ingress.includes('proxy-next-upstream-tries: "3"'), 'ingress must define retry-safe upstream tries');
  assert(ingress.includes('proxy_set_header Upgrade $http_upgrade;'), 'websocket upgrade headers must be configured');
  assert(ingress.includes('keepalive_timeout 15s;'), 'slowloris mitigation timeout must be configured');
}

function testIngressEnvironmentOverlays() {
  const staging = read('deploy/k8s/overlays/staging/patch-ingress.yaml');
  const prod = read('deploy/k8s/overlays/prod/patch-ingress.yaml');
  assert(staging.includes('staging.abzora.example.com'), 'staging ingress hosts must be separated');
  assert(prod.includes('abzora.com'), 'prod ingress hosts must be separated');
  assert(prod.includes('prod-abzora-api-tls'), 'prod tls secret names must be configured');
}

function testIngressObservabilityArtifacts() {
  const obs = read('deploy/k8s/base/ingress-observability.yaml');
  assert(obs.includes('kind: ServiceMonitor'), 'ingress observability must include ServiceMonitor');
  assert(obs.includes('kind: PrometheusRule'), 'ingress observability must include PrometheusRule');
  assert(obs.includes('nginx_ingress_controller_requests'), 'ingress failure metric alert must be configured');
}

function run() {
  testDeploymentSafety();
  testAutoscalingSafety();
  testTopologyAndDisruptionSafety();
  testReadinessEndpointWiring();
  testIngressTrafficSafety();
  testIngressEnvironmentOverlays();
  testIngressObservabilityArtifacts();
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
