# SRE Deployment Checklist (Invoice Ops)

1. `npm run ops:validate-invoice-env`
2. Redis HA/persistence enabled.
3. BullMQ workers healthy and concurrency set.
4. Resend webhook secret configured.
5. Cloudinary authenticated/raw credentials validated.
6. Replay confirmation secret set.
7. Metrics scrape for `/metrics/invoices/prometheus` configured.
8. Alert rules enabled for queue/email/storage.
9. Runbook links attached to on-call rotation.
10. Replay drill completed in staging.
