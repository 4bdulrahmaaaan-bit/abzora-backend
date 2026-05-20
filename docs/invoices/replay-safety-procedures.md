# Replay Safety Procedures

## Safety gates
- Admin auth + invoice permission (`invoices_queue`)
- Invoice replay confirmation secret
- Endpoint rate limiting
- Audit logging (`InvoiceReplayAuditLog`)

## Pre-checks
1. Validate root cause resolved.
2. Confirm queue pressure:
   - waiting
   - failed
   - delayed
3. Confirm provider health:
   - Resend
   - Redis
   - Cloudinary

## Safe replay pattern
1. Replay in batches (`limit <= 25` preferred).
2. Wait 30-60s between batches.
3. Stop replay if failed ratio rises.
4. Capture replay audit log references in incident ticket.

## Idempotency
- Webhook events are deduped by event ID.
- Generation queue dedupes by `jobId` + order-level check.
- Replay targets email logs (safe to retry due to suppression + attempts).
