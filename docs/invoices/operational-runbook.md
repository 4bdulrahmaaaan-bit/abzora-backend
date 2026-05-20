# Invoice Operations Runbook

## Scope
- Email lifecycle webhooks
- DLQ replay and queue recovery
- Suppression handling
- Freeze/legal hold controls

## Core endpoints
- `POST /api/invoices/webhooks/resend`
- `POST /api/invoices/admin/queue/replay-dlq`
- `POST /api/invoices/admin/queue/pause`
- `POST /api/invoices/admin/queue/resume`
- `GET /api/invoices/admin/replay-dashboard`
- `GET /api/invoices/admin/suppressions`
- `POST /api/invoices/admin/suppressions`
- `PATCH /api/invoices/admin/:invoiceId/freeze`

## Replay procedure
1. Check `/health/queue` and `/metrics/invoices/queues`.
2. Confirm error source (provider outage vs bad payload).
3. Pause queue if failure storm is ongoing.
4. Fix root cause.
5. Replay with confirmation token:
   - `confirmation = INVOICE_REPLAY_CONFIRMATION`
6. Monitor replay dashboard and failure ratio.
7. Resume normal traffic.

## Bounce/complaint handling
1. Resend webhook marks email logs as `bounced`/`complained`.
2. Suppression row is auto-created.
3. Future sends are blocked with `suppressed` status.
4. Admin can manually override suppression entry.

## Cloudinary outage behavior
- Invoice PDF storage falls back to local and logs warning.
- Recovery action:
  1. Restore Cloudinary credentials/connectivity.
  2. Regenerate signed URLs from persisted asset metadata.
  3. Replay failed email jobs after verification.

## Redis outage behavior
- BullMQ operations degrade; rate limiter fail-closed in production.
- Recovery action:
  1. Restore Redis.
  2. Validate worker start and queue metrics.
  3. Replay dead-letter jobs in controlled batches.
