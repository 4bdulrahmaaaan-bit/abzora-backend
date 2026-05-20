# Invoice API Docs

## Core
- POST `/api/invoices/generate/:orderId`
- GET `/api/invoices/:invoiceId`
- GET `/api/invoices/my`
- GET `/api/invoices/download-link/:invoiceId`
- GET `/api/invoices/download/:invoiceId?token=...`

## Admin
- GET `/api/invoices/admin/list`
- GET `/api/invoices/admin/export/csv`
- GET `/api/invoices/admin/export/xlsx`
- GET `/api/invoices/admin/reports/gst`
- POST `/api/invoices/admin/:invoiceId/regenerate`
- POST `/api/invoices/admin/:invoiceId/cancel`
- POST `/api/invoices/admin/:invoiceId/credit-note`
- GET `/api/invoices/admin/credit-notes`
- GET `/api/invoices/admin/email-logs`
- POST `/api/invoices/admin/email-logs/:emailLogId/resend`

## Public Verify
- GET `/api/invoices/verify/invoice/:invoiceId`
