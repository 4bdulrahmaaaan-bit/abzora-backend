# ABZORA Invoice Generator (Production Module)

## Backend Endpoints
- `POST /api/invoices/generate/:orderId`
- `GET /api/invoices/:invoiceId`
- `GET /api/invoices/my`
- `GET /api/invoices/download-link/:invoiceId`
- `GET /api/invoices/download/:invoiceId?token=...`
- `GET /api/admin/invoices`

## Admin + Ops
- `GET /api/invoices/admin/list`
- `POST /api/invoices/admin/:invoiceId/regenerate`
- `POST /api/invoices/admin/:invoiceId/cancel`
- `GET /api/invoices/admin/export/csv`
- `GET /api/invoices/admin/reports/gst`

## Queue/Retry
- Jobs stored in `InvoiceJob`.
- Worker: `invoiceQueueWorkerService` started in `server.js`.
- Retries with backoff and failure state.

## Security
- Immutable hash of snapshot (`signedHash`).
- Signed download token (10 min TTL) via HMAC.
- Role-based access for customer/vendor/admin.

## Storage
- Local: `backend/storage/invoices`
- Cloudinary provider supported via `INVOICE_STORAGE_PROVIDER=cloudinary`
- S3 fallback modeled (local fallback path retained).

## Environment
- `INVOICE_STORAGE_PROVIDER=local|cloudinary|s3`
- `INVOICE_SIGNING_SECRET=...`
- `ABZORA_GSTIN=...`
- `ABZORA_ORIGIN_STATE=Tamil Nadu`
- Optional: install `qrcode` dependency for QR embeds.
