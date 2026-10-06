# Stripe sandbox payment development

The API has a Stripe hosted Checkout adapter for **test mode only**. The customer order payment route requires a persisted Sabre PNR before it can create a Checkout Session. Creating a PNR does not issue a ticket.

## Local configuration

Keep these values in the ignored root `.env` file:

```dotenv
PAYMENT_PROVIDER=STRIPE_TEST
PAYMENT_CHECKOUT_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

The hosted Checkout integration uses the secret key on the API. The publishable key is available for a future embedded card form; it is not needed for the hosted redirect. `STRIPE_WEBHOOK_SECRET` is the signing secret for the **specific test webhook endpoint**, not an API key. Never put `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` in a `VITE_*` variable.

The webhook URL is `POST /api/v1/payments/webhooks/stripe`. Configure the test endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. The webhook secret is optional for local sandbox testing: an authenticated server-side Stripe status query also confirms payment, and the API polls pending payments every 30 seconds. A browser return does not confirm payment. Without the signing secret, webhook requests return 503.

The config rejects this combination in `APP_ENV=production`. To disable local test checkout, set `PAYMENT_CHECKOUT_ENABLED=false` or `PAYMENT_PROVIDER=NONE`.

## Current boundary

Public guest checkout still saves a contact submission for staff follow-up. It does not create a Sabre PNR or payment order. The Stripe adapter therefore cannot be reached from that guest page yet. The Sabre CERT booking outcome marked `BOOKING_UNKNOWN` must be reconciled before another Create Booking request. Automatic cancellation at the earlier of 30 minutes or Sabre's ticketing deadline also remains to be implemented and verified before enabling a full booking-to-payment flow.
