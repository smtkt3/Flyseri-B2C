# B2C booking improvements — 6 October 2026

## Implemented

1. **Booking recovery:** An uncertain reservation response pauses further submissions in the tab. A separate action reads the saved booking without replaying a supplier request. The existing server reservation claim and ownership checks remain authoritative after a page refresh or another tab. Known pre-reservation validation/authentication errors can be corrected. Booking details include a recovery panel and support links with the selection/booking reference. Active reservation/ticketing operations use bounded foreground polling of Flyseri's saved status only; unknown operations still require reconciliation.
2. **Cache infrastructure:** The five-minute demand-driven cache and supplier-failure cooldown remain active. `compose.cache.yml` prepares a loopback-only Redis service with a persistent volume, AOF and a memory limit. `scripts/start-trial-cache.ps1` starts and checks Redis before setting a missing local REDIS_URL, preserving existing connection settings. Docker/Redis are unavailable on this computer, so shared Redis is **prepared, not running**. The memory cache remains active. Do not expose this local Redis configuration publicly; deployment requires approved private infrastructure and credentials.
3. **Checkout progress:** Travelers → Extras → Review & reserve → Payment → Confirmation. Entering extras is optional; request selectors do not claim an airline purchase. Payment completion advances to confirmation and does not mark tickets issued.
4. **Price clarity:** Existing API-backed fare/tax and purchased-extra arithmetic remains unchanged. Guest fare refresh and acceptance continue to compare the selected fare; payment summaries use server order items. Unconfirmed service requests and quote-only ancillaries stay excluded from totals. The inactive promo-code placeholder has been removed. Paid airline-extra fulfillment remains unavailable in this trial.
5. **Mobile:** Fixed total/continue controls on traveler checkout, reservation review and eligible payment pages. Controls reuse existing guards and actions; consent and fare acceptance are not bypassed. Safe-area spacing, 44px controls, readable fields, keyboard focus and reduced-motion support preserve the Flyseri palette.
6. **Booking dashboard:** Separate reservation, payment and ticket milestones on booking cards, details and payment review. Payment review uses provider-verified order/payment status rather than redirect parameters. Refreshing the list reads saved records, not Sabre. Support links preserve booking context.
7. **Presentation and drafts:** Consistent loading placeholders, status colours and spacing across booking/order screens. Private passenger/contact and billing drafts stay only in bounded tab memory, expire after 30 minutes and are isolated by account and checkout identity. Guest details can follow the existing sign-in overlay; switching away from an existing account resets fields. Refreshing the browser clears unsaved drafts. Saving a traveler for future use still requires the existing explicit checkbox. No new private fields are written to localStorage or router history.
8. **Performance visibility:** Staff with the flights permission can read `/api/v1/admin/flights/metrics`. It reports current-process counters, cache-hit percentage, bounded p50/p95 search/first-result/supplier timings, CERT mode and cache health/settings. Samples contain durations only; identities, passport data and credentials are not included. Existing booking, validation, duplicate-prevention counters and commerce reconciliation remain available. Metrics are process-scoped and reset on API restart; this is not a hosted monitoring dashboard.

## Verification and limits

- Customer-web/API TypeScript compilation and customer-web build passed.
- Localhost homepage, flight search, checkout shell and booking shell respond successfully; API health returns 200. These shell responses do not establish authenticated account visibility.
- The staff metrics endpoint rejects anonymous access with 401.
- Redis startup script passed PowerShell syntax parsing. Docker execution and Redis restart persistence could not be verified without an installed runtime or supplied Redis connection.
- Browser inventory is empty and the in-app browser is unavailable. Desktop/mobile visual review and authenticated checkout remain pending a connected test-account browser.
- No new reservation, Stripe payment, ticket or EMD was created during this update. Sabre remains CERT-only, Stripe remains sandbox-only, and ticket issuance stays disabled under the existing trial settings.

## Start shared caching when Docker is available

Run from the workspace:

```powershell
.\scripts\start-trial-cache.ps1
```

Restart the API after the script confirms Redis is healthy. The service binds only to `127.0.0.1:6379`, and expired quotes remain expired after restart. The Compose configuration follows the [official Redis Docker storage guidance](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/docker/).

This update improves the existing trial flow; it does not establish airline ticketing/paid-extra fulfillment or a complete production B2C rollout.
