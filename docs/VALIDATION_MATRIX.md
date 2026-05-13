# Validation Matrix

## Core middleware
- `validateBody`: [validation/schemaValidator.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemaValidator.js)
- `validateQuery`: [validation/schemaValidator.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemaValidator.js)

## Schema files
- Mutation schemas: [validation/schemas/mutationSchemas.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemas/mutationSchemas.js)
- Admin/finance/ops schemas: [validation/schemas/adminFinanceOpsSchemas.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemas/adminFinanceOpsSchemas.js)
- Customer-facing schemas: [validation/schemas/customerSchemas.js](/C:/Users/AAA/Documents/abzio/backend/validation/schemas/customerSchemas.js)

## Route-to-schema mapping (high level)
- `POST /payment/create-order` -> `createPaymentOrderSchema`
- `POST /payment/verify` -> `verifyPaymentSchema`
- `PATCH /orders/:id/status` -> `updateOrderStatusSchema`
- `PATCH /orders/:id/delivery-status` -> `updateDeliveryStatusSchema`
- `PATCH /orders/:id/rider-location` -> `updateRiderLocationSchema`
- `POST /orders/refund-requests/:refundId/reject` -> `rejectRequestSchema`
- `POST /orders/return-requests/:returnId/reject` -> `rejectRequestSchema`
- `GET /orders/refund-requests` -> `orderStatusListQuerySchema`
- `GET /orders/return-requests` -> `orderStatusListQuerySchema`
- `GET /products` -> `productListQuerySchema`
- `GET /stores` -> `storeListQuerySchema`
- `GET /delivery/check` -> `logisticsDeliveryCheckQuerySchema`
- `GET /vendor/ops/orders` -> `logisticsVendorOrdersQuerySchema`
- `GET /vendor/ops/trial-requests` -> `logisticsVendorTrialsQuerySchema`
- `POST /vendor/withdraw` -> `withdrawalRequestSchema`
- `POST /vendor/payout-account` -> `payoutProfileSchema`
- `POST /rider/withdraw` -> `withdrawalRequestSchema`
- `POST /rider/payout-account` -> `payoutProfileSchema`
- `GET /ops/alerts` -> `opsAlertsQuerySchema`
- `GET /ops/zones` -> `cityQuerySchema`
- `GET /ops/dashboard/map` -> `opsMapQuerySchema`
- `GET /ops/metrics` -> `opsMetricsQuerySchema`
- `GET /ops/logs` -> `paginationQuerySchema`
- `GET /fleet/zones` -> `cityQuerySchema`
- `POST /fleet/dispatch/recommend` -> `dispatchRecommendSchema`
- `POST /fleet/bulk-actions` -> `bulkFleetActionSchema`
- `GET /admin/users|stores|products|orders|notifications|payouts|disputes|activity-logs` -> `paginationQuerySchema`
- `GET /admin/kyc/vendors|kyc/riders|trial-home` -> `statusQuerySchema`
- `POST /admin/users/:id/action` -> `userActionSchema`
- `POST /admin/users/:id/role` -> `userRoleSchema`
- `POST /admin/products/:id/action` -> `productActionSchema`
- `POST /admin/notifications` -> `adminNotificationSchema`
- `PATCH /admin/disputes/:id` -> `disputeUpdateSchema`
- `POST /admin/activity-logs` -> `activityLogCreateSchema`
- `PATCH /admin/kyc/vendors/:id/review` -> `kycReviewSchema`
- `PATCH /admin/kyc/riders/:id/review` -> `kycReviewSchema`
- `PATCH /admin/trial-home/:id` -> `trialHomeUpdateSchema`
- `POST /admin/finance/settlements/run` -> `runSettlementsSchema`
- `PATCH /admin/finance/fraud-alerts/:alertId` -> `fraudAlertUpdateSchema`
- `POST /admin/finance/withdrawals/:requestId/reject` -> `rejectRequestSchema`
- `POST /auth/referrals/apply` -> `referralApplySchema`
- `POST /auth/growth-offers/validate` -> `growthOfferValidateSchema`
- `POST /auth/growth-offers/claim` -> `growthOfferClaimSchema`
- `POST /tracking/location-update` -> `trackingLocationUpdateSchema`
- `POST /tracking/order-status-update` -> `trackingOrderStatusUpdateSchema`
- `GET /support/chats` -> `supportListQuerySchema`
- `GET /support/chats/:id/messages` -> `supportMessagesQuerySchema`
- `POST /support/chats` -> `supportCreateChatSchema`
- `POST /support/chats/:id/messages` -> `supportSendMessageSchema`
- `POST /support/chats/:id/read|close|reopen` -> `emptyBodySchema`
- `POST /chats/:id/messages` -> `chatSendMessageSchema`
- `GET /social/feed|looks/trending` -> `socialFeedQuerySchema`
- `POST /social/look/share` -> `socialShareLookSchema`
- `POST /social/look/:id/vote` -> `socialVoteSchema`
- `POST /social/post` -> `socialCreatePostSchema`
- `POST /social/post/:id/like` -> `emptyBodySchema`

