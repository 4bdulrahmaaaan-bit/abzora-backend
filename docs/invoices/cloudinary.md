# Cloudinary Integration Docs

- `resource_type: raw`
- `type: authenticated`
- `overwrite: false`
- Folder: `ABZORA/invoices/{year}/{month}`
- Public ID: `{invoiceNumber}-{versionLabel}`
- Metadata includes checksum, orderId, customerId.
- Signed URL generated per-request with expiry.
