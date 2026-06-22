# ABZORA Backend

Production backend for ABZORA using:

- Node.js + Express
- MongoDB + Mongoose
- Cloudinary
- Razorpay
- Firebase Auth only
- Redis-backed rate limiting recommended in production

## Setup

1. Copy `.env.example` to `.env`
2. Fill all environment variables
3. Install dependencies:

```bash
npm install
```

4. Run locally:

```bash
npm run dev
```

## API Summary

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /auth/me`
- `POST /stores`
- `GET /stores`
- `GET /stores/:id`
- `POST /products`
- `GET /products`
- `GET /products/:id`
- `POST /orders`
- `GET /orders`
- `POST /orders/create-razorpay-order`
- `POST /orders/verify-payment`
- `POST /upload`
- `GET /delivery/check?product_id=...&lat=...&lng=...&pincode=...`
- `POST /rider/assign`
- `GET /order/track/:id`

## Delivery APIs

### Check delivery availability

`GET /delivery/check?product_id=<id>&lat=<lat>&lng=<lng>&pincode=<pincode>`

Example response:

```json
{
  "available": true,
  "eta": "Today",
  "eta_minutes": 185,
  "vendor_id": "68175f6ab0b2f53f0f97f6cd",
  "distance_km": 4.2
}
```

### Assign rider

`POST /rider/assign`

Body:

```json
{
  "orderId": "6817618db0b2f53f0f97f744",
  "sameDay": true
}
```

### Track order

`GET /order/track/:id`

Example response:

```json
{
  "success": true,
  "data": {
    "order_id": "6817618db0b2f53f0f97f744",
    "status": "Out for delivery",
    "rider": { "lat": 12.9716, "lng": 77.5946, "status": "active" },
    "updated_at": "2026-05-04T13:10:14.000Z"
  }
}
```

## Deployment

### Render

1. Create a new Web Service from the `/backend` folder
2. Build command:

```bash
npm install
```

3. Start command:

```bash
npm start
```

4. Add all environment variables from `.env.example`
5. On Render, Firebase Admin should use env vars instead of a local JSON file:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
6. Set `ENFORCE_HTTPS=true` in production and terminate TLS at the load balancer or platform edge
7. Set `REQUIRE_EMAIL_VERIFICATION=true` for password-based Firebase sign-ins
8. Set `AUTH_MAX_SESSION_AGE_MINUTES` so users must re-authenticate periodically
9. Keep `ENABLE_TEST_AUTH_ROUTES=false` in every non-local environment
10. Keep `REDIS_REQUIRED=true` and `RATE_LIMIT_FAIL_CLOSED=true` in production so abuse controls fail closed when Redis is unavailable

## OpenTelemetry rollout

The backend supports OpenTelemetry with production-safe defaults and keeps existing custom telemetry context.

Required environment variables:

- `OTEL_ENABLED=true|false` (default `false`)
- `OTEL_SERVICE_NAME=abianzo-backend`
- `OTEL_EXPORTER_PROTOCOL=http|grpc|console` (default `http`)
- `OTEL_EXPORTER_OTLP_ENDPOINT=https://<otel-endpoint>/v1/traces` (HTTP) or `host:4317` (gRPC)
- `OTEL_SAMPLING_RATIO=0.0..1.0` (recommended `0.10` to `0.25` in production)

Recommended production baseline:

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=abianzo-backend
OTEL_EXPORTER_PROTOCOL=http
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.monitoring.svc.cluster.local:4318/v1/traces
OTEL_SAMPLING_RATIO=0.15
```

Kubernetes env wiring guidance:

- Add OTEL env vars to API/worker/websocket deployments in ConfigMap or Secret.
- Use staging first with low sampling (`0.05`) and verify `/health/ready` telemetry.openTelemetry status.
- Keep exporters non-blocking; request paths must not wait for export completion.

Tempo/Jaeger compatibility:

- OTLP HTTP endpoint works with Grafana Tempo collector (`:4318/v1/traces`).
- OTLP gRPC works with Tempo/Jaeger collectors supporting `:4317`.
11. Configure Mongo pool and retry env vars (`MONGO_MAX_POOL_SIZE`, `MONGO_MIN_POOL_SIZE`, `MONGO_CONNECT_MAX_ATTEMPTS`, etc.) for your pod count and workload burst profile

### MongoDB Atlas

1. Create a cluster
2. Create a database user
3. Whitelist Render outbound IPs or allow trusted access
4. Set `MONGO_URI`
5. Never expose MongoDB to the public internet without strict IP allowlisting and strong credentials

## Firebase Auth Integration

Frontend sends Firebase ID token as:

```http
Authorization: Bearer <firebase-id-token>
```

Backend verifies the token and creates the user in MongoDB on first authenticated request.

## Security Notes

- Do not deploy `serviceAccountKey.json`; production only loads Firebase credentials from environment variables.
- Do not expose OpenAI, Razorpay secret keys, database credentials, or admin service credentials to Flutter/web builds.
- Authentication, authorization failures, API errors, rate-limit events, and suspicious traffic are logged as structured security events.

- coderabbit test branch
