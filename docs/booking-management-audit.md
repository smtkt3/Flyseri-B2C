# Booking management audit — 10 October 2026

## Local demo

Open `http://localhost:8443/demo/bookings`. No sign-in or payment credentials are required.

The demo is also linked from **My bookings** and from the homepage **Special Flight Offers** checkout.

1. Select a sample route, travel date and traveller count; reserve the demo flight.
2. Review the total and choose **Successful payment**, **Declined payment**, or **Pending confirmation**.
3. For success, download the demo receipt, then prepare a separate demo ticket document.
4. For decline, retry before the original five-minute deadline.
5. For pending, another payment and cancellation are blocked. Simulate approval or failure to resolve it.
6. Wait beyond five minutes to test expiry. Pending approval after expiry is recorded as needing review, and cannot prepare documents.
7. Test cancellation before payment, or the simulated refund after payment.
8. Reload or return to the demo list to verify that the same record and deadline are restored.

All operations remain in this tab's session storage. No booking/payment/airline API is called by the demo service. Records use `DEMO-` identifiers and numbered sample passengers; no entered names, card data, passport information or booking contact details are saved. Session storage is editable by the browser user and is **not** inventory or payment evidence. The demo keeps at most 20 records. Closing the tab normally ends the session; browser session recovery may restore it.

## Fixes to existing booking management

- The booking detail's payment action now uses `FlightPaymentPreparation`, including reservation evidence, current fare and extras checks, before creating an order.
- Cancelled and uncertain PNRs no longer display a confirmed reservation milestone.
- A booking is shown as fully ticketed only with a distinct issued document for every passenger. Partial, duplicated and voided evidence does not qualify. Previously ticketed records with incomplete current evidence need attention.
- Payment preparation and ticket issuance now share a confirmed-itinerary check: flight status, route, carrier, flight number, both local dates and both local times must match the accepted itinerary.
- Payment event processing locks the order before the payment, matching payment-attempt reservation and avoiding opposite lock acquisition during concurrent retries/webhooks.
- Booking refresh/cancellation results and order payment/receipt/refresh results are ignored after navigation to a different record. Checkout capabilities and confirmation are reset for each order.
- Existing server ownership, unique reservation/order/payment-attempt rules, webhook amount verification, ambiguous-outcome handling and separate ticket issuance remain active.

## Validation and limits

Verified results: **38/38 targeted API tests** and **59/59 targeted customer tests** passed. Reports: `artifacts/booking-api-tests.json` and `artifacts/booking-final-web-tests.json`. These are targeted regression runs, not the entire repository test suite.

The customer production build and API/customer typechecks passed. Legacy flight tests were updated for the current fare drawer, extras navigation, automatic fare validation and separate billing step.

API tests use PGlite fixtures and mocked airline/payment providers, including authenticated customer ownership and admin role permissions. Customer tests exercise the rendered demo flow, booking navigation, billing, extras, expiry and recovery. They do not perform real supplier reservations or collect money.

The customer production bundle and API/customer typechecks are separate gates. Local HTTP checks verify the Flyseri app identity, demo module and API readiness. Physical iPhone/Safari rendering and a live external-provider round trip have not been verified during this audit. An in-memory database test cannot establish PostgreSQL behaviour under production traffic.

Real airline changes, paid-booking cancellations and refunds continue through staff review of provider rules; the demo refund is not a real refund integration. The separate CRM admin frontend at port 3093 is outside this checkout. This audit checks the booking/admin API permissions in this repository, not the authenticated CRM frontend.
