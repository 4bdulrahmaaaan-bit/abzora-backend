# Invoice Incident Response Checklist

## Detection
- Alert fired (queue failures, webhook errors, suppression spike, download failures).
- Capture `requestId`/`traceId` and initial impact window.

## Triage
1. Check:
   - `/health/ready`
   - `/health/queue`
   - `/health/email`
   - `/health/storage`
2. Identify blast radius:
   - generation only
   - email only
   - download only
   - multi-system

## Containment
1. Pause impacted queue if needed.
2. Enable provider fallback path (if available).
3. Freeze sensitive invoices when legal/finance asks.

## Recovery
1. Fix root cause.
2. Replay DLQ in batches.
3. Validate outcomes with replay dashboard + audit logs.

## Post-incident
1. Publish timeline and root cause.
2. Add/remediate alert gaps.
3. Update runbooks and checklist.
