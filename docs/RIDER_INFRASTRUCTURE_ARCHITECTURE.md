# ABZORA Rider Infrastructure and Fleet Intelligence Architecture

## Implemented Layers
- Rider management control plane with live statuses, KPI strip, AI scoring, and operational drawer.
- Fleet intelligence API layer under `/fleet` for dashboard, zones, alerts, performance, simulation, and bulk actions.
- Dispatch scoring and performance scoring services (`fleetIntelligenceService`).
- Simulation engine (`fleetSimulationService`) for surge/weather/outage forecasting.
- Real-time cache primitives (`fleetRealtimeService`) on top of Redis key patterns.
- WebSocket event fanout reused from `trackingGateway` with fleet event publishing.

## Real-Time Data Model
- `rider:live:{id}`
- `zone:{id}` snapshots
- `order:{id}:tracking` (existing)
- dispatch queue events via `fleet_alert`, `dispatch_update`, `order_status_update`

## Dispatch and AI Features
- Weighted dispatch score:
  - distance * 0.4
  - active orders * 0.3
  - rating * -0.2
  - batch efficiency * -0.1
- Rider performance engine outputs 0-100 score + color tier.
- Alert generation for risk patterns: battery, delay, fraud, complaints, inactivity.

## Endpoints
- `GET /fleet/live-dashboard`
- `GET /fleet/zones`
- `GET /fleet/alerts`
- `GET /fleet/riders/performance`
- `POST /fleet/dispatch/recommend`
- `POST /fleet/simulate`
- `POST /fleet/bulk-actions`

## Operations UI
- New `/riders` premium command center.
- Sticky enterprise filters.
- AI insights and tactical right rail.
- Live fleet map panel (hotspots + zone dots).
- Bulk controls and emergency workflows.

## Scale Extensions Ready
- Plug Kafka consumers into `fleetRealtimeService` for event ingestion.
- Promote zone snapshots and rider pings to dedicated TTL streams.
- Extend `trackingGateway` namespaces (`/admin`, `/rider`, `/vendor`, `/customer`) with room-level fleet events.
- Connect ETA engine and route optimization provider to dispatch score inputs.
