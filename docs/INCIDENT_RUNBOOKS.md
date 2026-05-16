# Operational Incident Runbooks

## Mongo Failover Runbook

1. Confirm failover symptoms:
   - connection errors, high server selection timeout, readiness failures.
2. Validate Mongo replica set health and electable nodes.
3. Trigger provider failover (or wait for automatic failover).
4. Watch backend readiness and pool saturation metrics.
5. Pause non-critical background jobs if pool saturation persists.
6. Verify payment write paths and outbox processing.

## Redis Outage Runbook

1. Confirm Redis reachability and error rates.
2. Keep critical controls fail-closed (`RATE_LIMIT_FAIL_CLOSED=true`, `OPS_LOCK_FAIL_CLOSED=true`).
3. Restore Redis HA service or failover replica.
4. Monitor queue lag, rate-limit backend status, lock state recovery.
5. Re-enable deferred low-priority workload gradually.

## Webhook Replay Storm Runbook

1. Detect replay spike from webhook ingest metrics.
2. Reduce ingest worker concurrency if downstream DB saturation rises.
3. Increase retry backoff/jitter temporarily.
4. Prioritize payment capture/refund events over non-critical events.
5. Validate duplicate protections remain active.

## Queue Saturation Runbook

1. Confirm queue depth, lag, and dropped/deferred counters.
2. Apply overload policy:
   - defer/reject low-priority jobs
   - preserve payment/order jobs
3. Scale workers via HPA/manual intervention.
4. Investigate producers causing tenant-level bursts.

## Dead-Letter Surge Runbook

1. Identify failing event types and common errors.
2. Halt unsafe replay if financial side-effect risk exists.
3. Patch root cause and run canary replay on sample batch.
4. Resume replay with bounded concurrency.
5. Track dead-letter drain rate and alert when normalized.
