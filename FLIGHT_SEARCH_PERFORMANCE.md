# Flight search performance

## Data preservation

- The source airport directory remains unchanged. `scripts/sync-airport-directory.mjs` copies all 9,054 entries to the API asset and checks identical bytes. API suggestions preserve the same matching/ranking and metadata; the browser fetches matching rows rather than the entire directory. The API asset must ship with the server build.
- Delta streams transmit complete fare objects for new/changed offer IDs and explicit removed IDs. The client reconstructs the full snapshot, preserving arrival order. Existing clients without the delta header retain full-response streaming.
- Supplier shopping payloads, fare/class coverage, quote lifetime, passenger data, reservation validation and payment logic remain intact. No persistence migration is required.

## Bounded CERT warming

`SABRE_CACHE_WARMUP_ENABLED=true` is enabled locally. Other installations default to disabled. The worker checks eligibility and cached OAuth every 10 seconds without delaying requests. It observes exact successful searches, considers only queries repeated at least twice, retains at most three recent criteria sets and forgets inactive searches after 15 minutes. There are no guessed dates or broad route sweeps.

The default limit is one warm search per minute (the existing pair of supplier shop calls). Redis applies the shared warmup quota, provider quota and existing request lock/semaphore. Local fallback is bounded too, including when a configured Redis connection is unavailable in development/test. Production still requires Redis. Only CERT is accepted. Refresh eligibility now leaves a supplier timeout plus one worker interval before cache expiry (38 seconds into the default 60-second lifetime). Quotas and active customer searches can defer a refresh; continuous warm-cache availability is not guaranteed. Refresh never extends an old quote's freshness; only a complete new supplier result replaces the cache. Failed/incomplete warmups retain the last complete quote until its original expiry. No reservation or ticket is created.

## Measurements

- API logs include `flight_first_result` (duration/count/cache status) separately from total search and supplier timings.
- Supplier timing logs now identify the `branded` or `cabins` branch, so remaining supplier delays can be distinguished without changing fare coverage or adding shopping calls.
- Browser User Timing entries are `flyseri.flight.first-result` and `flyseri.flight.search-complete`. The `flyseri:flight-search-timing` event includes first-result milliseconds, total milliseconds, offer count and completion status. It excludes identities and passenger details.
- Full per-fare development logs are opt-in with `SABRE_VERBOSE_SEARCH_LOGGING=true`; timing and count logs remain available without serializing every offer repeatedly.

## Hosting

Use an always-running API instance with the API and Redis in the same region/private network where supported. Current infrastructure endpoints have been preserved. Region placement and serverless cold-start settings are hosting controls: no deployment or cloud-resource relocation was performed. Warming cannot keep a suspended instance running; it operates when the Node process is alive.

The Redis connection uses TCP keepalive and bounded reconnect backoff. Requests retain a short connection timeout, one retry and no offline command queue, so reconnection does not leave user requests waiting indefinitely.

## Build evidence

The prior browser airport chunk was 2,302.51 kB (491.92 kB gzip). The new frontend build has no airport-directory chunk; the complete source stays on the API. TypeScript checks and the Vite build succeed. This proves the payload removal, not a fixed speedup for Sabre or every network. Supplier-response latency still needs measurements from real CERT searches using the added timing signals.

Recent local first-result metrics varied from 2,155 to 6,469 ms. In the 6,469-ms request, the first supplier HTTP response arrived at 6,398 ms; the following 71 ms included decoding, mapping, session storage and making results ready for streaming. These are server observations, not browser paint measurements or guarantees. Local configuration has no Redis URL and uses the bounded memory cache. First-time criteria still require Sabre; earlier warming mainly benefits repeated exact searches. The warmup scheduling follow-up compiles successfully; its latency improvement has not been measured with another supplier run.

## Results page UX follow-up

- Existing flight positions remain stable as later batches arrive. New matching flights append; an explicit Update order action applies the current ranking. Changing filters or sort intentionally recomputes the order. Authoritatively removed fares/flights are still removed.
- A compact sticky summary appears after the search form leaves the viewport and returns focus to the editable form. Existing navbar and colours are preserved.
- Flight rows emphasize departure/arrival times and total price, improve secondary-text readability and show the fare count beside the details action.
- Users can compare up to three exact fares across airlines/cabins. Comparison contains full-trip totals, itinerary, baggage and returned refund/change conditions; missing conditions are identified, never treated as free. Selection uses the existing owned search/booking path. The comparison panel is a separate optional JS chunk.
- Mobile filters use a bottom sheet with selected count, reset, close and Show N flights. Filters update the matching count immediately. It scrolls as one sheet, without the desktop sidebar's nested scrollbars. Dialogs trap keyboard focus, support Escape and restore focus.
- Up to three flight browsing snapshots are retained in memory, keyed to the browser history entry. Form, filters, sort, selected legs, displayed order, fare drawer and comparison selection can be restored. The first visible flight and its offset anchor the return position. Snapshots contain no passenger/contact/passport data; no localStorage/sessionStorage is used. Owned result sessions are not reused across account changes. Expired sessions refresh the original exact criteria; unsubmitted drafts are not automatically searched. Currency changes discard a price cap from the previous currency.
- Empty states list the active filters and provide reset/edit actions; a disappeared selected connection offers a fresh itinerary selection.
- Memoized flight rows use stable handlers and compare complete fare object references. Currency and date formatters are reused. Offscreen rows defer browser rendering through content-visibility without removing fare data, filtering options or search-session IDs.

Frontend TypeScript and Vite compilation succeeded. No automated tests or supplier transactions were run for this UX follow-up. Browser visual review was unavailable because the browser tool could not start its Node runtime. Rendering speed and visual behavior have not been measured in-browser; supplier request parameters and coverage remain unchanged.
# Demand-driven cache update

The local CERT setup now uses `SABRE_BFM_CACHE_TTL_SECONDS=300` and `SABRE_CACHE_WARMUP_ENABLED=false`. Complete results are reused for five minutes from their supplier search timestamp; repeated reads do not renew that timestamp. The configuration default remains 60 seconds for environments without an explicit setting. The example configuration recommends the five-minute trial setting. Partial/incomplete results retain their five-second lifetime.

Exact normalized route/date/passenger/cabin/currency criteria, PCC, environment and shopping policy remain part of the shared cache identity. Customers reuse the supplier result but receive separate owned search sessions. Existing request coalescing shares one supplier search among concurrent identical requests. A BFM search still makes the two existing requests needed to collect branded fares and cabins; no fare coverage was removed.

Supplier failures now create a five-second retry cooldown, shared through Redis when available and bounded in memory for local development. This prevents immediate retry storms. Quotes are checked against their original timestamp as well as storage expiry so copying a quote cannot make an old price fresh again. Reservation price checks and booking authorization are unchanged. No expired quote is served as current availability.

Validation: API TypeScript and the 22 targeted flight tests passed, including five-minute reuse across customers, expiry, ownership isolation, concurrent coalescing, failure cooldown/recovery and disabled speculative warming. Local development currently has no configured Redis, so its cache is lost on API restart. Shared Redis remains required for production and multiple API instances.

Live localhost CERT check (KUL–DAC, 16 October 2026, one adult, Economy, MYR): first search returned 252 fares in 6,824 ms; subsequent identical searches returned the same supplier timestamp and all 252 fares in 20 ms and 14 ms, each with a separate search session. These are local HTTP timings, not browser rendering guarantees. The local cache also now evicts least recently used entries after removing expired entries, keeping frequently searched routes within its 50-entry bound.

