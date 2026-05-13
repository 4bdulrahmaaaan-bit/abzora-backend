# Security Hardening Phase 2 Report

## Scope
Phase 2 covered API security hardening for mutation and query surfaces across backend domains:
- payments/webhooks
- orders/refunds/returns
- finance/admin/ops/fleet
- customer-facing auth/tracking/support/chat/social

## Critical issues fixed

1. Secret handling hardening
- Removed committed Firebase service account key file.
- Enforced env-first Firebase Admin credential loading with explicit local-file opt-in.
- File: [config/firebase.js](/C:/Users/AAA/Documents/abzio/backend/config/firebase.js)

2. WebSocket token leakage reduction
- Disabled query token auth by default; requires explicit opt-in.
- Files:
  - [services/trackingGateway.js](/C:/Users/AAA/Documents/abzio/backend/services/trackingGateway.js)
  - [services/pricingGateway.js](/C:/Users/AAA/Documents/abzio/backend/services/pricingGateway.js)
  - [.env.example](/C:/Users/AAA/Documents/abzio/backend/.env.example)

3. Webhook replay/idempotency controls
- Added dedupe lock service with unique key and TTL index.
- Applied to payment + payout webhook handlers.
- Files:
  - [services/webhookLockService.js](/C:/Users/AAA/Documents/abzio/backend/services/webhookLockService.js)
  - [controllers/paymentController.js](/C:/Users/AAA/Documents/abzio/backend/controllers/paymentController.js)
  - [controllers/financeController.js](/C:/Users/AAA/Documents/abzio/backend/controllers/financeController.js)

4. Debug endpoint hardening
- Mounted `/debug` behind admin auth and rate limiting.
- File: [server.js](/C:/Users/AAA/Documents/abzio/backend/server.js)

5. Mutation-path bug fixes
- Fixed invalid JavaScript status-map check in order status update path.
- Fixed numeric finite checks in rider location update.
- File: [controllers/orderController.js](/C:/Users/AAA/Documents/abzio/backend/controllers/orderController.js)

## Validation framework rollout

- Added query validator middleware:
  - [validation/schemaValidator.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemaValidator.js)

- Added schema packs:
  - [validation/schemas/mutationSchemas.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemas/mutationSchemas.js)
  - [validation/schemas/adminFinanceOpsSchemas.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemas/adminFinanceOpsSchemas.js)
  - [validation/schemas/customerSchemas.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemas/customerSchemas.js)

- Route-to-schema mapping:
  - [docs/VALIDATION_MATRIX.md](/C:/Users/AAA/Documents/abzio/backend/docs/VALIDATION_MATRIX.md)

## Route classes now covered
- Payment/order critical mutations
- Refund/return admin actions
- Finance/admin settlement and fraud-status mutations
- Vendor/rider payout and withdrawal mutations
- Admin list/query endpoints with strict query filtering
- Ops/fleet list/query and selected control mutations
- Customer-facing tracking/support/chat/social/auth referral-growth mutations and queries

## Test evidence

Executed with passing results:
- `node tests/security-mutation-validation.test.js`
- `node tests/http-negative-security.test.js`
- `node tests/customer-route-validation-http.test.js`

Test files:
- [tests/security-mutation-validation.test.js](/C:/Users/AAA/Documents/abzio/backend/tests/security-mutation-validation.test.js)
- [tests/http-negative-security.test.js](/C:/Users/AAA/Documents/abzio/backend/tests/http-negative-security.test.js)
- [tests/customer-route-validation-http.test.js](/C:/Users/AAA/Documents/abzio/backend/tests/customer-route-validation-http.test.js)

## Deployment checklist

1. Set/verify environment values:
- `ALLOW_WS_QUERY_TOKEN=false`
- `WEBHOOK_LOCK_TTL_SECONDS=604800` (or org policy equivalent)
- Firebase env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)

2. Rotate any previously exposed credentials (if not already completed):
- Firebase service account key used in prior commits.

3. Confirm webhook delivery lock index creation in production logs/DB:
- `uniq_webhook_lock_key`
- `ttl_webhook_lock_created_at`

4. Run regression tests in CI on merge:
- three security test files above.

## Residual risk / next recommended actions

1. Add controller-level business rule tests for edge cases (beyond schema and gate tests).
2. Add structured security event metrics for validator rejects (400 class monitoring).
3. Add Sentry live triage once `SENTRY_AUTH_TOKEN` is configured in execution environment.

