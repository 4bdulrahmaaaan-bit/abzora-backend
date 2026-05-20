# ABZORA Invoice Enterprise Finalization

## Scope
- Additive hardening only; no existing invoice API removed.
- Backward compatibility retained for Flutter/admin integrations.

## Implemented hardening
- BullMQ reliability:
  - Exponential backoff defaults.
  - DLQ queue (`invoice-dead-letter`) and worker.
  - Stalled-job settings and worker runtime stats.
  - Queue metrics API support.
  - Job dedupe by deterministic job IDs + order-level idempotency check.
- Security:
  - Invoice-specific read/write rate limiting.
  - Admin invoice permission matrix middleware.
  - Anti-enumeration response normalization for not-found invoice paths.
- Immutability:
  - Snapshot expanded to include vendor/customer/pricing/tax-rate snapshots.
  - Hash verification preserved for tamper detection.
- Cloudinary/storage:
  - Checksum and metadata/tags persisted.
  - Storage anomaly scanner added (orphan/missing checksum signal).
- Observability:
  - Added endpoints:
    - `/health/queue`
    - `/health/storage`
    - `/health/email`
    - `/health/invoices`
    - `/metrics/invoices/queues`
- Compliance/reporting:
  - GST report extended with HSN/SAC summary and sequence-gap signal.

## Deployment additions
- `Dockerfile`
- `ecosystem.config.js` (PM2 baseline)
- Env validator script: `npm run ops:validate-invoice-env`

## Operational TODO (external infra)
- TODO: wire Cloudinary Admin API cleanup policy automation.
- TODO: configure Resend webhook endpoint for bounce/complaint ingestion.
- TODO: configure long-retention archival bucket for regulatory exports.
