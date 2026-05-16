# Monthly Restore Drill Runbook

## Cadence

- Frequency: monthly
- Owner: Platform SRE
- Participants: DB engineer, backend on-call, finance ops representative

## Drill Inputs

- Target backup timestamp
- Drill environment cluster
- Validation dataset checksums from production baseline

## Drill Process

1. Create drill record:
   - drill id
   - incident-style ticket id
   - operators and observers
2. Restore Mongo snapshot to isolated environment.
3. Restore Redis data from selected AOF/RDB.
4. Start app stack against restored data.
5. Run validation checklist.
6. Measure achieved RPO/RTO.
7. Document gaps and remediation tasks.

## Validation Checklist

- Auth and health endpoints operational.
- Order/payment counts within tolerance.
- No negative inventory values.
- Outbox pending/dead-letter totals match expectations.
- Webhook ingest backlog metrics sane.
- No duplicate payment/refund side effects on replay checks.
- Queue lag and worker utilization within thresholds.

## Integrity Verification

- Compare sampled order lifecycle traces against source baseline.
- Verify financial totals for selected windows.
- Verify idempotency markers on outbox/webhook ingest records.

## Drill Rollback Plan

1. Destroy drill environment after evidence capture.
2. Ensure no production credentials persisted in drill logs/artifacts.
3. Archive drill report and attach to quarterly reliability review.

## Required Drill Artifacts

- `backend/ops/backup/backup-status.json`
- `backend/ops/backup/restore-drill-report.json`
- Command transcript and operator timeline
