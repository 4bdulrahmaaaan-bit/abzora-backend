# ABZORA Production Backup, Restore, and DR Policy

## Scope

This policy covers:
- MongoDB primary data stores
- Redis operational state (cache, queue/lock state)
- Payment outbox and webhook ingest durability guarantees
- Regional failover procedures

## SLO Targets

- RPO (MongoDB): `<= 5 minutes` (point-in-time restore capable)
- RTO (MongoDB full restore): `<= 60 minutes`
- RTO (regional failover to warm standby): `<= 45 minutes`
- RPO (Redis ephemeral operational data): `<= 15 minutes`

## Ownership

- Backup owner: `Platform SRE On-Call`
- Restore owner: `Incident Commander (IC) + Database Engineer`
- Payment data correctness approver: `Finance Ops Lead`
- Application validation approver: `Backend On-Call`

## Escalation Path

1. `Primary On-Call (SRE)` opens incident and starts timeline.
2. `Database Engineer` joins within 10 minutes for restore/failover commands.
3. `Backend Incident Owner` verifies application-level data consistency.
4. `Finance Ops Lead` signs off on payment/outbox reconciliation.
5. `Engineering Manager` approves production traffic re-enable.

## Backup Strategy

### MongoDB

- Use managed continuous cloud backup with PITR enabled.
- Daily snapshots retained by policy.
- Weekly restore verification in non-prod.
- Monthly full restore drill in isolated environment.

### Redis

- Enable AOF (`appendonly yes`) plus periodic RDB snapshots.
- Run Redis in HA mode in production (sentinel/cluster).
- Persist `appendfsync everysec` for durability/latency balance.

### Outbox/Webhook Durability

- `PaymentOutboxEvent` and `PaymentWebhookIngestEvent` are system-of-record for replay safety.
- Do not purge failed/dead-letter events before retention window.
- Retain processed events long enough for forensic replay windows and audit needs.

## Retention Policy

- MongoDB PITR logs: 7-14 days minimum (prod), 3-7 days (staging).
- Mongo snapshots: daily for 35 days, weekly for 12 weeks, monthly for 12 months.
- Redis AOF archives/snapshots: 7 days minimum for incident replay.
- Payment outbox + webhook ingest dead-letter events: 90 days minimum.

## Compliance Requirements

- Every restore action must produce:
  - incident id
  - operator id
  - start/end timestamp
  - validation checklist result
  - sign-off list
