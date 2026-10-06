# B2C trial status — 4 October 2026

## Latest booking UX update — 6 October 2026

See `B2C_BOOKING_UX_UPDATE.md` for booking recovery, separate reservation/payment/ticket milestones, private tab drafts, mobile checkout controls, loading states, protected performance metrics and the prepared Redis setup. The local memory cache remains active until a Redis runtime or testing URL is available. Browser visual review and an authenticated sandbox walkthrough remain pending. CERT ticket issuance and paid airline-extra fulfillment are still disabled/unavailable; this update does not mark the whole B2C process complete.

## Implemented in this update

- Meal, extra baggage, wheelchair, hearing/vision assistance and free-text requests in guest traveler details and saved-traveler selection.
- Shared airline-offer lookup UI in both checkout paths. ATPCO uses agency SOAP GetAncillaryOffersRQ 3.2.0; NDC uses the existing agency Get Ancillaries REST connection.
- ATPCO discovery transmits itinerary and passenger count, without names or travel-document data. Unsupported child/infant and codeshare discovery fails with a clear message.
- Existing dedicated service_requests database field carries requests through fare review, reservation details, order/payment review, staff booking detail, and downloaded reservation summaries.
- Airport timezone display corrected in traveler details.
- Server configuration rejects production Sabre endpoints. Stripe configuration accepts test secret keys only.

## Reservation follow-up

- ATPCO reservation payloads now support adults, children and lap infants. Saved dates of birth must match the searched passenger counts and remain in the same age category through the last flight; one lap infant is associated with each accompanying adult.
- Standard meal, wheelchair and hearing/vision SSR requests are included in ATPCO CreateBooking payloads. Paid baggage requests and notes remain staff requests; they are not purchases. SSR submission does not establish airline confirmation.
- NDC fare validation now calls Offer Price and verifies the returned price, expiry, passenger references, flight times, airports, carrier, flight number and booking class against the selected offer. Priced offer/item references are persisted with the owned intent.
- NDC reservation creation uses the documented Booking Management flightOffer variant, reprices immediately before sending, and stops when the accepted price differs. Legal names, birth dates and gender come from owned traveler records. Carrier-specific passport requirements and unsupported response shapes still require assistance.
- Guest checkout no longer rejects NDC or child/infant searches unconditionally. Saved-traveler checkout displays server validation errors so missing birth dates and mismatched ages can be corrected.
- These reservation additions have passed TypeScript compilation. They have not been demonstrated with a successful CERT reservation and must not be described as operational airline fulfillment.

## Current local configuration

Sabre CERT, reservation execution enabled, Stripe test checkout enabled. Ticketing execution disabled. Redis and Stripe webhook signing configuration are absent; payment status reconciliation already uses the server's existing status flow. Do not describe webhook delivery as verified.

## Sandbox checkout and UI follow-up

- Added responsive booking progress to fare review, reservation detail and flight payment review, preserving Flyseri's blue/teal styling.
- Redesigned order/payment review with a sticky total summary, sandbox disclosure, payment review checkbox, provider-confirmed completion, pending/failure/expiry states, receipts, reservation links and support navigation.
- Added bounded foreground status polling on pending payments. Returning from Stripe is not treated as success; confirmation still comes from authenticated provider status or a verified webhook.
- Returning without payment can resume the same verified, open Stripe Checkout Session. Its order reference, amount, currency, test mode and redirect host are checked before returning its URL. Active and uncertain attempts are not replaced.
- Fixed fresh checkout setup after a verified failed attempt. Historical session references remain on attempts; the active payment reference is cleared before a new setup so reconciliation cannot apply an old session's failure to the new attempt.
- Updated order history counts, paid/unpaid filters, empty states and payment-history copy. The signed-in browser displayed the new order page and zero existing orders; no test order or payment was created in this update.
- Added optional passport entry at reservation review. Passport details must belong to selected travelers, have a valid expiry after the trip, and use owned profile names/birth dates/gender. They are sent with ATPCO/NDC reservation payloads and are not persisted by Flyseri. Browser consent and a direct disclosure precede submission. No actual passport or reservation submission was performed; carrier acceptance remains unverified.
- Missing Stripe webhook signing configuration remains explicit. The sandbox's existing reconciliation poller and authenticated status checks provide the current fallback; webhook delivery is not established.

## Evidence from this update

- API and frontend type checks passed.
- Frontend build passed.
- Browser displayed actual CERT shopping results: 309 fares for KUL–DAC, 5 November 2026.
- Traveler-details page visibly contained all request selectors and the airline lookup button.
- Fresh agency ancillary lookup completed for US-Bangla BS316 and returned no additional offers. This does not establish availability for other airlines/routes, paid-extra fulfillment, or complete response-mapping coverage.
- No reservations, payments, tickets or EMDs were created during this update. No automated tests were added or run.

## Not complete

- Paid ancillary selection, booking, charging and EMD reconciliation. Current requests are not purchased or airline-confirmed extras; displayed quotes are excluded from totals.
- Approved Sabre settlement and printer assignment for actual CERT ticket/EMD issuance. These remain skipped for the trial as previously requested.
- Successful CERT reservation evidence for the newly added NDC and child/infant paths, including airline SSR statuses and carrier-specific document requirements.
- An end-to-end authenticated checkout and sandbox payment run covering these changes.

The whole B2C system must not be marked complete based on documentation access, compilation, or one empty ancillary response. Continue from these remaining items; preserve the supplied frontend and CERT-only execution.

## Flight search repair — 5 October 2026

- Confirmed the configured Sabre CERT OAuth credentials work. The failed localhost searches came from a local API process whose outbound connections were blocked by its launch sandbox. Restarted only the Flyseri API with approved network access.
- Branded-fare and cabin-alternative shopping now run concurrently. The new authenticated-or-public POST `/flights/search/stream` endpoint emits each successful set immediately through NDJSON. Cached searches return their result immediately.
- Search sessions and fare IDs remain stable as more results arrive. Early fares can be selected before the other shopping request finishes. Foreign accounts cannot claim another account's partial session.
- A failed shopping branch retains successful fares and marks the result incomplete. Such results have a five-second cache lifetime, so they are not cached as a full search for the usual duration. A failed branch with no usable fares reports an error rather than claiming there are no flights.
- The customer screen keeps available flights visible, shows a compact background-search indicator, preserves filters while results arrive, and provides a retry action. Editing the search cancels its old stream and clears mismatched results.
- Live CERT searches through the localhost Vite proxy: KUL–PEN on 18 November 2026 emitted 74 fares at 3,550 ms and 228 total fares at 3,987 ms. KUL–DAC on that date emitted 226 fares at 6,993 ms and 301 total fares at 7,217 ms. A cached repeat returned 301 fares in 33 ms. These are observations from these runs, not latency guarantees.
- Validation: 26 API tests and 27 customer-web tests passed; API/customer-web TypeScript checks, API compilation and the customer-web build passed. Tests cover partial delivery before completion, retention after branch failure, stable selectable owned sessions, and network chunks that split JSON lines.
- Browser UI automation was unavailable in this run. UI behavior was checked with component tests; live supplier responses and streaming were verified through localhost. No reservation, payment, ticket or EMD was created by this search repair.

## Checkout price breakdown — 5 October 2026

- Preserved Sabre's aggregate equivalent/base fare and tax total in the quoted currency through the supplier mapping and public DTO. Components are included only when base fare plus taxes equals the quoted total exactly in minor units. Missing or inconsistent components retain the overall airfare rather than producing invented amounts.
- The traveler checkout sidebar shows the trip type, passenger count, base fare, taxes and airline charges, total airfare, and currency. It uses the latest refreshed shopping offer; the lower checkout total now uses that offer too. Known meal information moved to the airline-services section.
- Changed the response-profile cache identity so fresh searches obtain the new pricing metadata.
- Live CERT KUL–SIN search on 18 November 2026 returned 211 fares, all with reconciled breakdowns. One returned MYR 136.00 base fare plus MYR 152.00 taxes, totaling MYR 288.00.
- Validation: 31 API tests and 26 customer-web tests passed, including mixed-currency rejection, mismatched-component omission, aggregate passenger totals, legitimate zero taxes, and refreshed totals. API/customer-web compilation and the frontend build passed. Existing checkout selections need a fresh search or fare refresh to acquire the newly added metadata.

## Reference price card and extra line items — 5 October 2026

- Matched the requested layout: expanded/collapsible Tickets row, passenger-type unit prices and quantities, Fare and Taxes & fees rows, separate Baggage/Meals sections, free/included statuses, and a prominent Total below a dashed divider.
- Added actual Sabre passengerTotalFare unit pricing and passengerNumber quantities to the DTO. Passenger subtotals must reconcile with the aggregate base fare and taxes; inconsistent/missing unit data retains aggregate rows rather than inventing average passenger prices.
- Live two-adult KUL–SIN CERT quote verified MYR 136 base fare plus MYR 152 taxes per adult, totaling MYR 288 × 2 = MYR 576. Cache identity changed to obtain the new unit-price metadata.
- Traveler baggage and meal requests now appear in the card as Requested and remain outside totals. Known included services show Free; unknown inclusions are omitted.
- The summary component can render explicit purchased extra records and calculate ticket plus extra totals in minor units. It rejects mixed currencies, duplicate IDs, invalid quantities and invalid passenger references. This is presentation/calculation support: paid ancillary purchase, EMD fulfillment, server-authoritative extra order pricing and Stripe charging for extras remain unconnected and disabled in this trial. The traveler route currently supplies service requests, not purchase records.
- Verification: 15 API tests and 28 customer-web tests passed; TypeScript checks and builds passed. Tests include actual passenger-unit reconciliation, purchased baggage/meal totals, duplicate/currency protection, and exclusion of unpurchased quotes and requests. No ancillary purchase, payment or EMD was created in this update.
# CERT reservation rejection correction — 5 October 2026

## Flight search performance improvements

- Removed the full airport directory from the browser bundle. The API asset is a byte-identical copy of all 9,054 source entries; autocomplete returns the same ranked matches and complete metadata. Airport labels/grouping/coordinates remain available. Existing source files and customer data are retained.
- Added negotiated delta streaming: full fare objects are transmitted only for new/changed IDs, with explicit removals and full snapshot reconstruction on the client. Legacy full-stream clients remain supported.
- Stabilized search-stage and price memoization, reused airport lookups by code, and kept suggestion caching public/account-independent. No fare, cabin, baggage or itinerary field was removed.
- Added separate API/browser first-result and total-search timings. Detailed per-fare log serialization is opt-in; timing/count logs remain.
- Enabled bounded local CERT-only warming for exact successful queries repeated by customers, with existing provider locks/quotas, one warm search/minute by default, and a 15-minute inactivity cutoff. Incomplete warm responses do not replace complete cache entries. Redis/OAuth are warmed while the server runs; Redis uses TCP keepalive and reconnect backoff.
- TypeScript and frontend builds pass. The previous 2,302.51 kB airport browser chunk is absent from the new build. Hosting colocation and cold-start policy still require deployment configuration; no cloud endpoints were changed or production supplier API used. See `FLIGHT_SEARCH_PERFORMANCE.md`.

## Progressive flight arrival

- Shopping still uses the existing two parallel Sabre CERT requests. No additional supplier search call was added.
- Cached search results are streamed before popular-map cache updates; stream headers flush immediately. Identical searches handled by separate workers receive partial results through short-lived Redis progress records, with revision polling to avoid repeatedly transferring fare payloads.
- The browser merges results by offer ID in arrival order, updates existing fares and reveals later arrivals without the initial display-count limit. Customer-selected sorting still applies. New flight rows use a brief entrance animation, disabled for reduced-motion preferences.
- First returned flights remain selectable while further cabin/fare responses load. Partial-search errors preserve available results. There is no artificial waiting interval.
- API/frontend TypeScript and the frontend build pass. Live supplier latency and the browser appearance were not measured in this update.

## Organized flight search results

- Preserved the Flyseri navbar, blue/mint palette, existing search fields and progressive Sabre results.
- Added compact flight rows showing local departure/arrival times, day changes, connecting cities, carrier, flight numbers, total trip price, fare count and direct access to the fare drawer. Known included checked baggage and low seat availability are shown only from returned fare data.
- Added searchable airline filters with flight counts and minimum returned prices, cancellation-before-departure filtering when supported by fare rules, direct-first and earliest-departure sorting, removable filter chips and a mobile filter toggle. Existing time, stopover, airport, aircraft, cabin, duration and price filters remain.
- Added a seven-day departure strip. Selecting another date runs a fresh search and preserves return-trip length. Date prices are limited to unexpired quotes already returned for matching criteria; unsearched dates show Search date. No forecast, promotion or unsupported price alert is fabricated.
- The fare dialog now moves keyboard focus inside, traps Tab and restores focus when closed. Responsive cards also adapt to available content width inside the account sidebar.
- Frontend TypeScript and Vite build succeeded. Browser visual review is unavailable because the browser runtime cannot start. No reservation, payment or production supplier API call was made for this UI change.

## Passenger passport entry and optional reuse

- The passenger form now collects passport number, expiry date and issuing country alongside personal details. Partial entries and passports expiring by the final flight are rejected.
- An unchecked checkbox lets customers choose whether to save that passenger and passport for future bookings. Booking-only traveler records remain available to their reservation but are excluded from the saved traveler list.
- Saved travelers can be selected in the passenger form, including their saved passport. Confirmed cards show the last four passport characters and the selected save preference.
- Unsaved passport details pass to reservation in account-scoped temporary memory, never router history or browser storage. The normal reservation page does not ask for them again. Refresh/expiry falls back to explicit re-entry.
- Opted-in passports are encrypted with AES-256-GCM in the private `traveller-private-data` Supabase bucket. Authorized API routes check traveler ownership. Archiving a traveler removes their saved passport. The server encryption key must remain stable and backed up.
- Shared packages, API and frontend compile; the frontend build succeeds. Browser visual review was unavailable due to the browser tool runtime failure. No supplier reservation or payment was made for this change.

## Subsequent uncertain attempt

- Latest attempt `6e9de704-68b2-4540-b658-3c3db51c718f` is `BOOKING_UNKNOWN`, without a saved PNR. No resend was made.
- Fixed a second diagnostic gap: uncertain responses now retain their reason, HTTP status, sanitized supplier errors, response field names and any syntactically valid candidate booking identifiers in the existing audit table. Earlier discarded responses cannot be reconstructed from these records.
- Changed the UI status from “Confirmation pending” to “Confirmation needs review” and clarified that it does not update automatically or prove creation/rejection.
- API compilation and frontend typecheck succeeded after these changes.
- The user explicitly approved a read-only exact-name Trip_SearchRQ within CERT PCC 73H8 after automatic approval review required permission. REST ATK was refused by the SOAP endpoint; documented SessionCreateRQ 2.0.0 authentication succeeded. Trip_SearchRQ returned Success with TotalResults=0 for the passenger's exact name. The session was closed successfully. No booking or cancellation was sent.
- Saved the search evidence in the existing audit table and exposed the completed lookup on the booking detail page. The attempt remains BOOKING_UNKNOWN: a scoped empty search does not recover the discarded creation response or prove that no PNR exists under another scope/name representation. No new booking is recommended until that uncertainty is resolved.

- Booking `7d70c153-9f28-4c8c-9caf-1a0bb5b62c51` remains `BOOKING_FAILED`, with no confirmed PNR. No replay was made.
- An intentionally incomplete CERT CreateBooking validation request (no travelers or flights) returned HTTP 400: `agencyCustomerNumber=73H8` violates Sabre's customer-number format. Omitting the optional field passed agency validation and returned the expected missing-travelers error. PCC remains configured for authentication and fare checks.
- Removed the optional customer number from local server configuration and the automatic PCC fallback. Future configured customer numbers are checked against the supplier format.
- Reservation rejection classifications are retained in the existing audit table and displayed as customer-safe failure messages. HTTP 200 validation errors without booking identifiers are classified as rejection; ambiguous supplier outcomes still require reconciliation.
- API restarted with corrected configuration. Shared types, API compilation and frontend typecheck succeeded. A successful fresh PNR has not yet been verified.
- The existing database lacks `booked_passenger_names` and `provider_view_snapshot`. Migration `0026_flight_booking_evidence.sql` remains pending: the configured database role cannot alter these tables. This is separate from the customer-number rejection; no historical passenger snapshot is fabricated.

