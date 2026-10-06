# Payment and automatic ticketing

## Implemented flow

1. Reserve once, retaining the server-side PNR and passenger snapshot.
2. Refresh the existing reservation checkout against Sabre: verify names, flights, confirmed segments and the same accepted fare. Extend the checkout window only within the provider's returned validity. No new reservation is created.
3. Verify selected extras, accept unchanged selected prices automatically, or show changed/unavailable services for a buyer decision. Confirmed extras become explicit order items.
4. Stripe hosted Checkout chooses eligible payment methods from the merchant Dashboard. The integration does not restrict checkout to card. QR methods depend on merchant country, currency, enabled methods and Stripe eligibility. No local QR button fabricates availability.
5. Signed webhooks or authenticated Stripe reconciliation verify the exact payment amount, currency and session. A success URL never marks an order paid.
6. A server worker scans persisted eligible paid bookings every 15 seconds. It runs independently of the buyer's browser and resumes across restarts. Ticketing uses the existing atomic database claim before Sabre fulfillment. Failures after sending require reconciliation and never trigger another issuance automatically.
7. Only Sabre's returned issued documents mark the booking ticketed. The confirmation page polls saved ticket status and links to the booking documents.

## Activation required

- Current integration remains Sabre CERT and Stripe test mode. No live money or travel-valid ticket is produced.
- Enable the intended payment methods in the Stripe test Dashboard. Method availability is determined by Stripe, not by display currency conversion.
- Supply the approved Sabre non-cash settlement and printer profile through server configuration. Enable ticketing only after the agency is approved. The worker remains idle when ticketing capabilities are unavailable.
- Paid extras also require the ancillary execution flag, approved checkout FX configuration and airline-specific document support.
- The evidence migration must exist. Existing ticketing capability checks enforce this.
- Late payments, changed itineraries/fares, legacy passenger evidence and uncertain supplier outcomes require staff review. Expiry is never bypassed to make a payment button work.
- Email ticket delivery is not implemented by this worker. It verifies ticket documents in the account; an email integration and delivery tracking are required before promising emailed tickets or a 24-hour delivery SLA.

## Production cutover

The repository currently enforces CERT-only Sabre endpoints, Stripe test keys/events/session IDs and non-production execution. Credential replacement alone does not activate production. A production cutover requires an approved environment adapter for live endpoints and payment verification, live agency ticketing authority, live webhook configuration, payment-method eligibility and operational reconciliation/email delivery. Keep these gates explicit; do not remove them merely to display a successful test ticket.

Stripe references: https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods and https://docs.stripe.com/checkout/fulfillment
