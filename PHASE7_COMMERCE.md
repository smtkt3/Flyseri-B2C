# Phase 7 commerce foundation

## Current capability

- A customer can create one unpaid flight order from an owned, unexpired `READY_FOR_PAYMENT` BookingIntent only after a Sabre PNR has been persisted. The amount and currency come only from the server-side validated fare. Repeated requests return the same order.
- Orders have immutable item snapshots. Customer order, payment, and receipt reads are ownership scoped. Receipt JSON is available only after an internally verified payment success, and is labelled a payment receipt rather than a tax invoice.
- Payment attempts use a database order lock, idempotency key, and a unique active-attempt index. An uncertain provider outcome stays `UNKNOWN` and requires reconciliation; it is never retried automatically. Duplicate and late verified events cannot reverse a confirmed success. An event arriving after fare expiry can mark funds paid while setting fulfilment to `REVALIDATION_REQUIRED`.
- Provider-neutral `PaymentProvider` and `PaymentEngineService` have a Stripe test adapter. Local Stripe test checkout is enabled only with explicit configuration; the adapter is rejected in production mode. A signed Stripe webhook route and authenticated Stripe status reconciliation are implemented. The API also polls pending test payments. See `STRIPE_SANDBOX.md`.
- Refunds, outbox, audit, and reconciliation state are database foundations only. No refund action, ticket issuance, receipt PDF, tax invoice, or outbox dispatcher is enabled.

## API

- `POST /api/v1/orders/flight` — `{ bookingIntentId }`.
- `GET /api/v1/orders`, `GET /api/v1/orders/:orderId`.
- `GET /api/v1/orders/:orderId/receipt` — confirmed paid orders only.
- `POST /api/v1/orders/:orderId/payments` — starts test Checkout only when explicitly enabled and a persisted PNR exists.
- `GET /api/v1/payments`, `GET /api/v1/payments/:paymentId`, `GET /api/v1/payments/capabilities`.
- `POST /api/v1/payments/webhooks/stripe` — signed Stripe test events only.
- Staff read-only: `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/:id`, `GET /api/v1/admin/payments`, `GET /api/v1/admin/payments/:id`.

## Database deployment

Migration `0011_overrated_firedrake.sql` creates the commerce tables and enables RLS. The dedicated `flyseri_api` login cannot run DDL. Apply the migration with a database owner and record its SHA-256 hash in `drizzle.__drizzle_migrations`; the development Supabase project was updated on 2026-09-26. `scripts/grant-flyseri-commerce.sql` grants only server-role access required by the implemented workflows; it does not grant deletion or refund-table access. Never put the database password or provider credentials in browser variables.

## Before enabling checkout

Local Stripe test checkout can use authenticated Stripe status queries and the 30-second reconciliation poller. Configure the test webhook signing secret when an endpoint or Stripe CLI forwarding is available. Reconcile the ambiguous Sabre CERT booking outcome before sending another booking request. Connect guest checkout to a validated Sabre PNR and order, then implement the unpaid-PNR cancellation worker using the earlier of 30 minutes or Sabre's deadline. Add alerting for `UNKNOWN` records that lack a Stripe Session reference. Test duplicate clicks, provider timeouts, duplicate and out-of-order callbacks, wrong amounts/currencies, IDOR, and staff authorization before enabling the full guest booking flow.
