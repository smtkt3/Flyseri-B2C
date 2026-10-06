# Airline extras implementation - 6 October 2026

## Customer experience

Expandable flight panels organize food and drinks, baggage, seats and other services. Traveler filtering, service search and add/remove controls preserve supplier associations and bundled prices. Choices follow checkout, booking review, booking details and the reservation summary. Service lookup runs when visible, with owner-scoped caching and retry cooldowns. Display estimates follow the selected currency; they never become settlement rates.

## Purchase software added

1. Owned booking review verifies immutable booked passenger names and the selected itinerary, then retrieves native service prices and private purchase references.
2. The customer reviews flight/traveler assignments, airfare, extras and total payable, and explicitly accepts or chooses ticket only before an airline addition attempt.
3. A durable ADDING claim is persisted under row locks before ModifyBooking. Uncertain outcomes become UNKNOWN, with payment locked and no automatic resubmission.
4. GetBooking must verify actual service item IDs, confirmed status, traveler/flight associations and native prices. Changed prices require separate acceptance without another addition.
5. Read-only reconciliation checks uncertain attempts and expired confirmed reviews. It does not resend ModifyBooking.
6. Only CONFIRMED extras enter a new order, as separate lines with totals computed on the server using integer monetary arithmetic. SKIPPED requests remain auditable without being charged. Existing orders remain intact.
7. The paid-booking issuance request includes confirmed ATPCO ancillary IDs or the approved NDC order fulfillment. A durable ticketing claim prevents automatic repeat issuance. Verified flight tickets and unverified extra documents have separate statuses.

Purchase state uses the existing intent JSON snapshot. No new purchase-state migration was introduced. Issuance still requires migration 0026 for immutable passenger and provider evidence.

## Not active or complete

Sabre has not supplied the approved non-cash settlement/printer profile. Migration 0026 was subsequently applied through the authorized Flyseri Supabase browser session on 6 October 2026: both booking evidence columns, the completed-fulfillment constraint and the Drizzle migration record were verified. Issuance and ancillary execution have not been enabled.

**EMD document inventory and issued-document reconciliation remain unimplemented.** The retained examples do not provide enough verified evidence to match each document to its passenger, service and coupons. The supplied CheckFlightTickets EMD example reports that EMD checking is unsupported. Successful fulfillment therefore leaves extras FULFILLMENT_PENDING; it cannot establish FULFILLED or a completed purchase.

No real ancillary addition, payment or document issuance was performed for this implementation. Compilation does not establish airline certification.

## Activation requirements

- Database prerequisite completed: [migration 0026](packages/database/drizzle/0026_flight_booking_evidence.sql) is applied and recorded in the Flyseri database.
- Sabre confirms non-cash CERT settlement, printer/country fields, PCC/carrier and EMD authority, and approved NDC arrangements. CASH remains prohibited by the user.
- Store the approved SABRE_TICKETING_PROFILE only in secure server configuration. NDC requires an explicit approved ndcAirlineCodes list and the required settlement fields. Never copy example payment credentials.
- Obtain the approved document inventory/retrieval contract, complete EMD reconciliation, and verify the workflow in CERT before activating ancillary purchases.
- Cross-currency checkout requires approved server-only FLIGHT_EXTRA_CHECKOUT_FX_RATES. Otherwise purchase is unavailable; the public display FX feed cannot be used for charging.
- Keep FLIGHT_ANCILLARY_EXECUTION_ENABLED=false until the requirements are met. Execution is restricted to non-production CERT with reservation and ticketing execution enabled.

Checkout rate configuration is a JSON object keyed by SOURCE:CHECKOUT. Each entry has string numerator, string denominator and ISO validUntil. The positive, unexpired ratio converts source minor units to checkout minor units. Checkout currencies with zero or two fractional digits are supported; other precisions need separate support. No actual rate was configured.

## Coverage limits

ATPCO purchase requires adult passengers, verified non-codeshare flights, complete canonical price/issuance metadata and one passenger per quoted purchase item. SSR-dependent services, paper-ticket items, ambiguous bundles and existing reservation extras need assistance. NDC requires explicit sellability, fresh supplier item references and an approved carrier profile. Unknown fields never imply permission to sell.

Categories work for returned services across airlines. Actual purchase coverage depends on airline/PCC entitlements and verified contracts; all-airline support is not claimed.

## Checks

Shared types and configuration compiled. API and customer-web TypeScript checks and the Vite build passed. Local Flyseri web (8443) and API health (3001) responded with HTTP 200. No automated tests or live Sabre purchase were run. Authenticated mobile/desktop visual review remains unverified because browser tools previously exposed no available browser.

References: [agency API map](reference/sabre/ANCILLARY_API_MAP_2026_10_04.md), [CERT activation](reference/sabre/CERT_TICKETING_ACTIVATION.md), [document inventory requirements](reference/sabre/EMD_REFUND_APP_REQUIREMENTS.md).
