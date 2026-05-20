const required = [
  'JWT_SECRET',
  'PUBLIC_BACKEND_URL',
];

const recommended = [
  'REDIS_URL',
  'INVOICE_STORAGE_PROVIDER',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'RESEND_API_KEY',
  'INVOICE_SIGNING_SECRET',
  'INVOICE_GEN_WORKER_CONCURRENCY',
  'INVOICE_EMAIL_WORKER_CONCURRENCY',
  'BULLMQ_STALLED_INTERVAL_MS',
  'BULLMQ_MAX_STALLED_COUNT',
];

function validate() {
  const missingRequired = required.filter((key) => !process.env[key]);
  const missingRecommended = recommended.filter((key) => !process.env[key]);
  if (missingRequired.length) {
    console.error('[invoice-env] missing required variables:', missingRequired.join(', '));
    process.exit(1);
  }
  if (missingRecommended.length) {
    console.warn('[invoice-env] missing recommended variables:', missingRecommended.join(', '));
  }
  console.log('[invoice-env] validation passed');
}

validate();
