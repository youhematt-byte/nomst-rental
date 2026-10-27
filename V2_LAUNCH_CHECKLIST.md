# NOM.ST_ 2.0 — Launch Gate (not production-ready)

## Current state
- Branch: `nomst-v2`. Do not merge into `main` until independently verified.
- `v2-preview.html` is a non-submitting prototype. Never enter real customer data.
- `api/v2-quote.js` computes a quote; no payment or reservation.
- `api/v2-availability.js` is staging-only and returns failure when staging is disabled.
- `api/v2-staging-booking.js` requires an operator bearer secret and a separate one-time submission token. It is not a public booking endpoint.
- SQL migrations 001–005 are source files only, not evidence of successful database deployment.

## Blocking launch checks
- [ ] Create isolated staging Supabase project and apply reviewed migrations in order; confirm extensions, RLS, RPC permissions.
- [ ] Fix and test idempotency/reconciliation for uncertain RPC responses; avoid blindly retrying.
- [ ] Confirm real inventory device identifier and physical quantity; never infer availability from staging.
- [ ] Implement public booking issuance with bot/rate-limit controls and explicit terms/privacy consent.
- [ ] End-to-end test two simultaneous overlapping reservations: exactly one succeeds.
- [ ] Verify quoted amounts, deposit and refund policies, delivery fees and payment reconciliation.
- [ ] Implement contract signature, private file access, retention/deletion job and audit trail.
- [ ] Implement durable notification outbox and test mail delivery.
- [ ] Review secrets and ensure no sensitive values or documents appear in client code, logs or email.
- [ ] Test Production environment separately and obtain approval before any cutover.

## Safety rule
Never enable public bookings, identity-document upload or payment solely because GitHub commit and Vercel deployment are Ready.
