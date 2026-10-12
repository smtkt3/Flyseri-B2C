# Customer frontend audit — 11 October 2026

## Result

The local customer frontend passed 292 automated tests in 56 spec files, TypeScript checking, a Vite production build and whitespace diff checks. This is verification of the current local frontend and simulated booking flow, not certification of live airline, payment or document services.

## Fixes made in this audit

- Country names now tolerate missing, empty, lowercase and malformed country codes. Incomplete visa data no longer crashes rendering.
- The destination hero has an accessible pause/play control. Reduced motion, data saving and background-tab pausing remain supported.
- Mobile demo booking pages no longer retain the blank space intended for an older fixed header. Compact phones use denser panels and a progress indicator that fits.
- Corrupt demo booking records have retry and explicitly confirmed reset controls. Reset affects only simulated booking records in the current tab.
- Demo reservations reject impossible calendar dates, including dates JavaScript would otherwise normalize into the following month.
- Demo checkout explains that sample names are not persisted and numbered demo travellers appear in management.
- Regression tests now follow the approved consolidated account navigation, current sample-content disclosure, API-backed airport suggestions and accessible service-request dropdowns.

## Browser checks

| Area | Observed result |
| --- | --- |
| Homepage validation | Missing destination displays a message and focuses the destination input. |
| Airport search | KUL resolves to Kuala Lumpur International Airport through the configured local API. |
| Flight search | DAC–KUL, 13 October 2026, one adult navigates with the correct parameters and renders API fares after loading. |
| Fare details | Itinerary, baggage and fare selection panel fit a 320-pixel viewport. No reservation was submitted to an airline. |
| Special offer | Missing date blocks continuation; choosing a date and two travellers calculates BDT 37,800. |
| Demo booking | Sample traveller step saves a reservation; the same five-minute deadline continues into payment. |
| Demo payment | Decline, retry, pending confirmation and approval work. A pending payment blocks another payment. |
| Demo documents and refund | Document preparation succeeds after payment; refund closes the booking and survives reload. |
| My travel | Bookings, Trips and Orders tabs navigate correctly; empty Orders state provides next actions. |
| Profile | Details, documents and preferences render; account navigation remains available. No personal data was edited or uploaded. |
| Rewards | A zero-point wallet displays the earning explanation and next action rather than a loading error. |
| Floating chat | Opens on account pages; its compact dialog fits inside 320 × 568 with room for the bottom navigation. |
| Responsive checks | Representative pages at 320 × 568 and 375 × 812 have no horizontal page overflow. Homepage checked at 895 × 600 and 1440 × 900. |

## Automated coverage

The suite covers one-way, return and multi-city search; provider errors and empty results; passenger review; fare changes; checkout continuation; payment preparation and interrupted-payment recovery; booking status; documents; visa flows; account preferences and photo validation; navigation; points; homepage map/chat; demo expiry, late payment approval, duplicate-payment prevention and refund transitions.

Final regression output: `artifacts/client-audit-full.json`.

## Remaining verification limits

- Browser viewport checks do not emulate real iOS Safari keyboards, safe-area behavior, touch performance or device memory limits. Test these on an actual iPhone before commercial launch.
- The full booking/payment/refund walkthrough used the isolated browser demo. Real airline ticket issuance, payment settlement, refunds and provider webhooks require separate integration testing.
- Real identity-document scanning and production policy/contact approval are outside this audit. Existing demo disclosures remain necessary.
- No production deployment, Git commit or push was performed for this audit.
