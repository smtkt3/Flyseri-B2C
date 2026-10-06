# Phase 10.5 booking execution audit (2026-09-29)

Primary contract reviewed: `reference/sabre/Booking_Management_API_v2_2026.08.postman_collection.json`, especially `CreateBookingAPI / ATPCO / Workflows / One way - 1xADT` (FlightShop, FlightCheck, CreateBooking, GetBooking). The older 2023.02 collection was not used. This audit precedes Phase 10.5 code changes.

## Current execution

| Area | Finding |
| --- | --- |
| Booking Management adapter | None. `apps/api/src/flight` has OAuth v3, BFM v5, and Revalidate Itinerary v5 clients only. |
| Create / Get / Modify Booking | None implemented. No Booking Management endpoint is called. |
| Confirm passenger | Local React form validation and summary collapse only. It does not call the API or create a PNR. |
| Public checkout Next | Validates local passenger/contact fields, then reports booking unavailable. Passenger data stays in browser state. |
| BookingIntent | Authenticated customer only: `CREATED` → validation → `READY_FOR_PAYMENT` or `PRICE_CHANGED`/`FAILED`; price confirmation can move `PRICE_CHANGED` to `READY_FOR_PAYMENT`. Expiry and cancellation exist. There is no PNR state. |
| Order creation | Authenticated `POST /orders/flight` creates an order from a fresh `READY_FOR_PAYMENT` intent, even with no PNR. One order per intent is enforced by a unique index. |
| Payment creation | Authenticated `POST /orders/:id/payments` would start after order creation. No payment provider is registered, so it currently returns 503 without charging. If a provider were enabled without a PNR gate, the current ordering would permit payment before a reservation. |
| PNR persistence | None. No Sabre confirmation ID, Booking Management booking ID, or last refresh is stored. |
| Ticket status | Orders have only `NOT_STARTED` / `REVALIDATION_REQUIRED` fulfillment states; no per-traveller ticket model or Sabre ticket verification. |
| Staff queue | Admin has flight search activity, orders, and payments. No `/admin/flights/bookings` queue or Get Booking refresh action. |
| Duplicate prevention | BookingIntent has customer/idempotency uniqueness and a Redis validation lock. Orders have one-per-intent uniqueness. There is no Create Booking reservation, unknown-result state, or booking reconciliation. |
| Schema | `flight_booking_intents`, traveller links, orders/items, payments/attempts/events, audit/outbox. No booking/PNR/ticket tables. |

## Contract and workflow gaps

- The supplied basic ATPCO CreateBooking example sends `agency` (address, customer number, ticketing policy), legal-name/date-of-birth travelers, contact email/phone, flight segment details and booking class, `flightPricing`, and `payment.billingAddress`. Its Postman script reads `confirmationId` and `booking.bookingId` from a successful response. The sample agency and billing details are illustrative and must not be used as Flyseri business data.
- GetBooking uses `POST /v1/trip/orders/getBooking` with a `confirmationId` in the body. The collection script reads `bookingId`, but the normalized response and ticket field mapping must be verified against CERT responses before enabling ticket detection.
- The collection's FlightCheck input is a journey/flight structure following FlightShop. Existing BFM v5 shopping and Revalidate Itinerary v5 do not prove that this FlightCheck sequence and PCC support booking the selected fare. The current normalized `FlightOffer` does not store a Booking Management offer ID.
- The public guest form has no customer identity or server-side passenger record; the authenticated BookingIntent path requires existing customer travellers. A guest ownership and retrieval model is needed before connecting the public form to PNR creation. The prior user requirement permits guest purchase without signing in.
- Real agency address, agency customer number, ticketing policy, optional billing address rules, and unticketed-PNR entitlement for this PCC have not yet been established from project configuration. The collection contains examples, not Flyseri settings.
- No live CERT CreateBooking test has been run. No production PNR or ticket should be created during development.

## Safety requirements for implementation

Keep Booking Management server side. Persist one booking row per BookingIntent before sending CreateBooking, use a database uniqueness constraint and state transition to prevent concurrent sends, and treat any timeout after send as UNKNOWN until reconciled. Do not retry that request blindly. Allow payment only after an authoritative PNR is persisted and the PCC payment sequence is confirmed. A PNR is a reservation, not a ticket. Mark `TICKETED` only from GetBooking's issued-ticket evidence. Do not enable Fulfill Flight Tickets or other ticket/refund automation in this phase.

## Implementation update (2026-09-30)

- Added the `flight_bookings` table and migration, with one row per BookingIntent and explicit reservation/exception statuses. The database repository atomically claims a fresh validated intent, records a confirmed PNR only once, and leaves uncertain attempts in `BOOKING_UNKNOWN` for manual reconciliation. Any existing attempt blocks another claim. Fare validation, price acceptance and cancellation are blocked after a booking attempt begins.
- Order creation and payment start now require a persisted PNR in an allowed reservation status. Automated tests cover no-PNR and unknown-result denial. This is a payment safety gate, not evidence that this PCC supports PNR-before-payment.
- Added server-only Booking Management 2026.08 request mapping for FlightCheck, basic ATPCO CreateBooking and GetBooking, and an OAuth-backed CERT transport. The adapter is not connected to a public CreateBooking route. CreateBooking never retries an ambiguous response.
- Added permission-guarded staff booking list/detail endpoints at `/api/v1/admin/flights/bookings` and a stored-PNR-only GetBooking refresh endpoint. Refresh records a verified lookup time and never changes ticket status. The 2026.08 collection shows `flightTickets[].ticketStatusName` and `number`, but issued-ticket mapping still needs controlled CERT response verification and per-traveller persistence.
- The guest `/flight-checkout` Next action now saves contact details and passenger names as an idempotent staff follow-up submission after local form validation and server-side offer lookup. It does not send ID/passport numbers or create a PNR, payment, or ticket. The page continues to say shopping fare, no reserved seat, no payment and no ticket.
- Customer-facing booking execution and payment checkout remain disabled by configuration. The separately approved CERT smoke script sent one CreateBooking request, but its result is unknown and no locator was returned. No payment or ticket request was sent. The supplied PCC/EPR/password values establish authentication inputs only; the collection's example agency address, customer number, billing address and `TODAY` ticketing policy are not verified Flyseri production settings. CERT account has returned an ATPCO FlightCheck response, but unticketed-PNR/payment entitlement remains unverified.
- The CRM Flights panel now reads protected guest submission and Sabre booking queues from the Flyseri API. A booking row reports paid only when the stored payment status is `SUCCEEDED`; a shopping submission is never represented as a PNR. Migrations through 0017 and restricted API role grants were applied to the linked Supabase project with user approval on 2026-09-30.
- Remaining Phase 10.5 work: secure guest booking identity for actual PNR creation, verified agency/ticketing/billing configuration, exact FlightCheck response and fare continuity mapping, controlled CERT BFM-to-PNR/GetBooking test, supported unknown-result reconciliation, ticket detection and per-traveller ticket records, and the payment/ticketing sequence after Sabre/PCC confirmation. The current staff queue UI has not been visually verified with a live staff session. No ModifyBooking operation was enabled because no specific change use case and contract mapping have been verified.

## CERT smoke check (2026-09-30)

- Server-side OAuth v3 succeeded in CERT. The earlier local 503 was caused by the workspace network sandbox (`EACCES`), not by a proved Sabre credential failure.
- A read-only CERT BFM search for KUL–PEN on 2026-12-10 returned 131 shopping offers. A direct MH test offer was checked through `/v1/offers/flightCheck`; Sabre returned two ATPCO fare alternatives. The shopping class was Q at MYR 305.76. FlightCheck's Q offer was BDT 9270, while the first alternative was class Y at BDT 43312. Its `bookingClassCodeValidation` labels did not identify the actual class reliably. The adapter now selects the unique exact class and PCC match and carries the checked currency/amount explicitly. This is a CERT observation, not a customer price guarantee.
- A reviewable CERT-only one-attempt smoke script is at `scripts/sabre-cert-booking-smoke.mjs`. Its read-only mode passed. Its CreateBooking path is pinned to MH1194 Q, KUL–PEN on 2026-12-10, shopping MYR 305.76 and checked BDT 9270; any changed fare aborts before sending. Automatic approval review initially rejected the exact sample payload; the user then explicitly approved it. One CreateBooking request was sent and returned an ambiguous result (`BOOKING_UNKNOWN`) without a confirmation locator. No payment or ticket request was made. The saved attempt marker is in the local temp directory. Do not resend CreateBooking. Get the test record locator from the Sabre CERT agent/PCC view using flight MH1194, the departure date, and the approved test passenger; then refresh by that locator through GetBooking. If Sabre cannot confirm whether the PNR exists, keep the attempt unresolved and contact Sabre support before any further CreateBooking.
