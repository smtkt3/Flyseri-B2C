# CERT non-cash ticketing activation

Ticket issuance remains disabled. The user rejected CASH. No example card, invoice arrangement or printer has been configured.

## Request for Sabre support / account manager

Subject: Confirm non-cash CERT ticket fulfillment for PCC 73H8

Agency: Seri Mechan Travel Sdn Bhd

Address: UG-14, Wilayah Complex, Jalan Dang Wangi, 50100 Kuala Lumpur, Federal Territory of Kuala Lumpur, Malaysia.

We are implementing Booking Management `fulfillFlightTickets` in CERT with OAuth v3. Customer payments use Stripe sandbox. Please confirm:

1. The enabled non-cash CERT settlement method: authorized agency invoice/account arrangement or a designated test payment card, with the exact request fields and test instructions.
2. Whether our supplied PTR is a ticketing printer address; confirm the hardcopy printer address and ticket country code for this PCC.
3. Ticketing and validating-carrier authority, any required PCC/TJR setup, and access to `fulfillFlightTickets`.
4. The current Agency Fulfillment Profile API schema and retrieval instructions for airline-specific fulfillment options.
5. How to retrieve/reconcile issued tickets after a timeout, and the permitted CERT void/refund procedure.

Send payment credentials through the approved secure channel. Application passwords and OAuth secrets are deliberately excluded from this draft. This request has not been sent.

The API catalogue describes fulfillment capabilities; it does not establish this agency's settlement or printer authorization. See the [Sabre collection](https://developer.sabre.com/product-collection/sabre-sandbox) and [Agency Fulfillment Profile service](https://developer.sabre.com/rest-api/agency-fulfillment-profile-service-api/1.1).

## Database prerequisite

The configured database role rejected migration with PostgreSQL `42501` (insufficient privileges). A database owner must apply [0026_flight_booking_evidence.sql](../../packages/database/drizzle/0026_flight_booking_evidence.sql) through the project's normal migration process. The actual workspace location is `packages/database/drizzle/0026_flight_booking_evidence.sql`.

**Completed 6 October 2026:** following explicit user authorization, migration 0026 was applied through the Flyseri Supabase browser session in one transaction. Both JSONB columns, the `COMPLETED` fulfillment constraint and the matching Drizzle migration record were verified. The earlier application-role permission failure is retained above as historical context; the database prerequisite is now complete. [Browser proof](../../scripts/flight-booking-evidence-migration-success.png).

Read-only queries using the application's configured database role also confirmed visibility of both evidence columns and the `COMPLETED` constraint. No customer records were modified or backfilled, and no database access permissions were changed.

This adds immutable booked passenger names, a provider view snapshot and the completed fulfillment state. Existing reservations can continue without these optional columns; new ticket issuance requires them. Legacy reservations without immutable passenger evidence require staff reconciliation.

## Server activation after confirmation

- Keep `SABRE_ENV=CERT` and Stripe test checkout configured.
- Set server-only `SABRE_TICKETING_PROFILE` with the approved `ticketCountryCode`, `hardcopyPrinterAddress`, and `formOfPayment`.
- INVOICE additionally requires `invoiceDescription` from the approved account arrangement.
- PAYMENTCARD additionally requires Sabre's designated `cardTypeCode`, `cardNumber`, `cardSecurityCode`, `expiryDate` (`YYYY-MM`) and any required `manualApprovalCode`.
- Set `FLIGHT_TICKETING_EXECUTION_ENABLED=true` only after authorization and migration. Never put this profile in browser code or `VITE_*` variables.

The implementation requires a verified matching Stripe test payment, an owned eligible PNR, matching passenger/itinerary evidence and one durable ticketing claim. NDC additionally requires an explicitly approved carrier list (`ndcAirlineCodes`) in the profile; payment-card NDC fulfillment requires the approved `cardHolder` billing address and `authentications` channel. These values must come from Sabre. An uncertain supplier result goes to manual review without automatic retry. Compilation does not establish supplier certification or a successful complete purchase.

## Ancillary progress and remaining gate - 6 October 2026

The user initially confirmed that neither prerequisite was supplied/applied. Migration 0026 was subsequently applied with explicit authorization through the browser, as recorded above. The Sabre profile remains outstanding; no activation flags were enabled.

The application now includes booked-service review, explicit customer price acceptance, a durable ModifyBooking claim, reservation-item verification, read-only reconciliation and confirmed extra charges in separate order lines. The ticket fulfillment request can include confirmed ancillary IDs. Extra-service document verification remains unfinished, and extras stay `FULFILLMENT_PENDING` after a fulfillment request until actual document evidence is reconciled.

Ask Sabre for the approved EMD inventory/document retrieval response contract, including document number/status, passenger, service/item ID and flight/coupon linkage, plus timeout reconciliation instructions. The supplied collection's CheckFlightTickets EMD example says it cannot check EMDs; do not use that operation as document confirmation.

Keep `FLIGHT_ANCILLARY_EXECUTION_ENABLED=false` until document reconciliation and CERT verification are complete. Cross-currency extras also require valid approved server-only `FLIGHT_EXTRA_CHECKOUT_FX_RATES`; public display estimates are not charge rates. See [airline extras status](../../AIRLINE_EXTRAS_STATUS.md) for coverage limits.
