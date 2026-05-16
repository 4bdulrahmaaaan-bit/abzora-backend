# Backup and Restore Runbook (Production)

## Preconditions

- Incident/ticket created with severity and owner.
- Change freeze enabled for write-heavy operations during restore.
- All actions recorded in incident timeline.

## MongoDB Backup Strategy

1. Enable continuous backup and PITR in managed Mongo provider.
2. Verify backup jobs daily:
   - last successful snapshot time
   - PITR log continuity
   - backup policy retention
3. Export weekly backup status JSON to ops evidence path:
   - `backend/ops/backup/backup-status.json`

## Full DB Restore Procedure

1. Identify restore timestamp and snapshot id.
2. Provision isolated restore target cluster.
3. Restore snapshot to target.
4. Run integrity checks:
   - order counts and payment status distribution
   - outbox dead-letter counts
   - webhook ingest pending/failed counts
5. Execute application smoke tests in read-only verification mode.
6. Swap application connection string if approved by IC.
7. Re-enable write traffic gradually.

## Point-in-Time Recovery Procedure

1. Determine corruption start timestamp.
2. Restore MongoDB cluster to timestamp `T-5m` before corruption.
3. Reconcile payment events after `T` via:
   - `PaymentWebhookIngestEvent` replay
   - `PaymentOutboxEvent` replay
4. Validate no duplicate financial side effects before traffic re-enable.

## Redis Recovery Procedure

1. If Redis outage only:
   - keep app in fail-closed mode for critical paths
   - restore Redis from latest AOF/RDB
2. If Redis data loss:
   - rebuild cache data lazily
   - replay retry/pending queue data from Mongo-derived durable records where available
3. Validate:
   - rate limiter backend healthy
   - queue depth normalizing
   - lock services healthy

## Region Failover Procedure

1. Promote warm standby cluster in target region.
2. Apply secret/config set for region B.
3. Shift traffic progressively (10% -> 50% -> 100%).
4. Validate:
   - `/health/ready` stable
   - outbox/webhook ingest worker healthy
   - payment success rates within baseline
5. Keep old region in read-only diagnostic mode until postmortem complete.

## Rollback Plan

1. If validation fails after restore:
   - stop traffic shift
   - revert connection strings/deployment to previous known good state
2. Resume old primary region/cluster.
3. Open follow-up incident for root cause.
