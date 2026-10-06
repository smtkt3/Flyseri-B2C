# B2C system completion

Requested on 2026-10-03: complete the existing Flyseri B2C system using the Sabre APIs shown by the user. Preserve the approved customer frontend. The user states that the displayed API collection is available to their account. Previous implementation order was PNR bookings first, followed by NDC.

Updated trial direction: the user authorized skipping ticket issuance and continuing the remaining trial work. Do not require production credentials or settlement approval to develop the trial. Airline-issued tickets remain disabled; no simulated ticket or EMD is presented as supplier fulfillment.

## Trial continuation implemented

- Public checkout now preserves page details through the existing sign-in overlay, obtains a fresh account-owned search, uniquely matches the original itinerary/class/brand, and requires review of the refreshed shopping fare. It saves or reuses matching owned traveller profiles and continues to fare validation and reservation. Only adult ATPCO reservations are currently supported. ID and frequent-flyer numbers remain in page memory and are not submitted.
- Booking contact email/phone carry into the reservation form. A supplier fare/currency change still requires explicit acceptance.
- Paid orders link back to the owned reservation. Downloadable payment receipts and reservation summaries explicitly distinguish payment/PNR evidence from a ticket.
- Paid booking pages explain that ticket issuance is skipped for this trial. Payment does not invent an airline ticket or change supplier fulfillment evidence.
- Direct support intake for changes, cancellation/refund review, passenger corrections, seats, baggage/meals, payments and visa assistance works without an AI provider. Customers review and confirm before a durable support/CRM handoff is queued. Requests do not execute airline changes or gateway refunds.
- Staff PNR refresh now returns mapped airline flights/passengers/tickets and optionally persists the view when the evidence column exists. Refresh alone does not mark a booking ticketed.

Automatic seat/ancillary purchase, NDC order creation, exchanges and refunds still need current provider contracts and account/carrier availability. The trial offers request intake for servicing; these supplier operations have not been implemented as completed customer fulfillment. Ticket delivery is deferred with ticket issuance. Evidence migration remains an owner action, but missing optional columns do not block the reservation/payment trial.

Ancillary 2.3 follow-up: shopping responses without item IDs now display correctly and remain explicitly non-sellable. Supplier pricing item references are retained and an internal Offer Price request builder is present. Purchase is still incomplete pending a verified pricing response mapper, owned NDC orders, add/fulfillment contracts and durable payment/service reconciliation. See `reference/sabre/GET_ANCILLARIES_AGENCY_2_3.md`.

Source: [Sabre Play PROD collection](https://developer.sabre.com/product-collection/sabre-sandbox). A product collection is a capability catalogue; its screenshots do not provide request/response schemas or business configuration. Account access is user-reported; individual runtime operations have not been verified in this work.

## Customer journey and completion criteria

The complete customer flow is search → select fare → passenger/contact entry → price/availability confirmation → seats/extras where supported → reservation → payment → issued tickets → manage booking. Existing account/trip, assisted visa, documents, support and CRM journeys remain part of the product.

| Area | Current code | Remaining work to complete |
| --- | --- | --- |
| Customer identity/profile/travellers | Supabase authentication and owned profiles; public checkout continues through account verification and owned search | Purchase without an account and secure guest recovery; lifecycle review |
| Trip planning | Existing trip, destination and traveller APIs | Complete cross-service itinerary and notifications |
| Flight search | Existing Sabre CERT BFM search, normalized fare cards and airport/airline directories | FlightShop continuity with reservation prices; child/infant age handling and NDC offer provenance |
| Fare confirmation | Revalidation plus FlightCheck; PCC currency/price changes require customer acceptance; supplier expiry caps freshness | Full customer/supplier journey validation |
| Adult ATPCO reservation | Supplied agency address configured, CERT reservation enabled, customer contact/billing form, one claimed attempt per intent | Account-specific booking sequence confirmation; reconcile the previously ambiguous CERT attempt before new supplier booking checks |
| My Bookings | Customer-scoped list/detail; optional current provider and immutable passenger snapshots | Apply evidence migration with database owner permissions; reconcile legacy passenger evidence |
| Airline booking view | GetBooking mapping for current flights, passenger names and ticket documents | Validate full schema/current response, map coupons and per-traveller ticket evidence, persist verified ticket records |
| Unticketed cancellation | Customer PNR confirmation, order exclusion, fresh provider preflight, cancellation request and follow-up verification; ambiguous results remain for manual review | Validate current response contract and runtime account/carrier behavior. Requires explicit flight/ticket/hotel/car arrays; insufficient evidence blocks cancellation |
| Passenger changes | Existing traveller profiles, separate from airline booking | Map actual airline passenger/contact modification contracts, booking signatures, ownership and operation idempotency |
| Seats and ancillaries | Per-flight baggage/meal information; NDC supplier offer/passenger references and expiry retained; session-scoped ancillary lookup and informational checkout display | Successful live NDC ancillary response on this CERT account, seat maps, selection, reservation, EMD issuance and provider-confirmed fulfillment |
| Customer payment | Stripe test hosted checkout, signed events, reconciliation, ownership/PNR gates, downloadable receipt and booking link | Automated refund workflow and operational reconciliation; production gateway outside current trial scope |
| Ticket fulfillment | CERT orchestration implemented behind disabled configuration: confirmed payment, durable claim, PNR preflight, fulfillment, ticket verification and uncertain-result manual review | Sabre-approved non-cash settlement/printer configuration, evidence migration, carrier/account validation, ticket delivery and staff reconciliation |
| Exchanges/refunds | No customer supplier operation enabled | Reshop offers, fees and fare difference approval, expiration, exchange/void/refund execution and audit/reconciliation |
| EMD ancillary refunds | Agency Ancillaries guide retained and app requirements reviewed; existing payment-refund table/audit/outbox foundations | Issued EMD/coupon inventory, eligibility/value evidence, exact service/auth contract, staff approval, one-document durable supplier execution, uncertain-result reconciliation and separate gateway payout tracking; see reference/sabre/EMD_REFUND_APP_REQUIREMENTS.md |
| NDC | Retained Order Management guide and example contracts; NDC shopping context and pre-booking ancillary lookup implemented | Current CERT NDC availability, offer pricing, NDC order create/view/sync/change/cancel/fulfillment/exchange/divide, current schemas and carrier rules |
| Assisted visa | Existing detailed applicant forms, compact saved bars, saved-form edit/add, documents/review/payment flow | Operational configuration and complete advisor/status notifications |
| Documents | Existing private vault, uploads and access APIs | Deployment storage/security services and lifecycle review |
| Support/CRM/staff | Confirmed direct support intake, protected staff APIs, mapped PNR refresh, CRM integration/outbox | Staff resolution of booking/payment exceptions; dispatch/alerting and full live workflow review |
| Production operations | Environment validation, logging, rate limits and database foundations | Production secrets and infrastructure, certification, service monitoring, deployment approval and complete end-to-end validation |

## Information requested from the user

1. Agency configured: **Seri Mechan Travel Sdn Bhd**, UG-14, Wilayah Complex, Jalan Dang Wangi, 50100 Kuala Lumpur, Federal Territory of Kuala Lumpur, Malaysia. The user confirmed using the configured PCC as the agency/customer number. `ticketingPolicy: "TODAY"` follows the supplied CERT ATPCO collection; it does not authorize ticket issuance. The user rejected CASH and does not know the authorized settlement method or printer assignment. A concrete Sabre support draft is in `reference/sabre/CERT_TICKETING_ACTIVATION.md`.
2. User confirmed the existing **Stripe sandbox** for the trial flow. A production gateway decision is deferred; secret keys belong in the server environment.
3. Current OpenAPI/Swagger or Postman export for the displayed Sabre collection, especially seats, ancillaries, exchanges and fulfillment. Existing project collections provide examples but do not establish all current response contracts.

## Implemented during this expansion

- Current GetBooking flights/passengers/ticket document DTO and customer display, excluding raw provider payloads and payment-card fields.
- Provider errors fail the PNR lookup rather than being treated as a successful refresh.
- `POST /api/v1/flights/bookings/:id/cancel` for eligible, unticketed flight-only bookings without an order. Customer must confirm the stored PNR. A database claim prevents concurrent cancellation requests. Supplier confirmation is re-read before marking cancelled. Failures after a mutation keep manual review status.
- Machine-readable reference catalogue of the local Postman operations, with collection provenance. This catalogue is documentation, not a generic provider proxy or proof of runtime support.

## Activation and evidence

Reservation execution is configured for CERT with the supplied agency details. Ticket execution remains disabled pending approved non-cash settlement and printer configuration. A verified Stripe payment now moves an eligible booking into the ticketing queue; it never marks it ticketed. Evidence migration `0026` is prepared, but the current database role rejected it with permission error `42501`. Optional evidence handling preserves the existing booking flow until an owner applies the migration.

No production PNR, customer charge, ticket issuance, cancellation or refund was performed during this expansion. API and customer builds pass. Code compilation/builds are separate from supplier certification and end-to-end verification. Automated tests were not run because the user did not request testing.

The system is **not yet complete or production-ready**. Keep this checklist current as integrations are implemented and validated. Do not present unsupported or unconfigured capabilities as active customer services.
