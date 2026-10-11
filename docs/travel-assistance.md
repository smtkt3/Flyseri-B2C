# Travel assistance

## Customer tools

- Flight search and Seri cards can check nearby dates explicitly (up to six extra searches). Return journeys retain their duration. Rankings use returned prices, duration, and connections; they are not airline endorsements.
- Signed-in customers can save up to 20 adult-only price watches at `/app/price-alerts`. A long-running API scans every minute, claims three due watches, and checks each approximately every six hours. Matches appear in the app. Email/push delivery and serverless scheduling are not implemented. Prices must be checked again before reservation.
- Seri offers a reviewed, customer-confirmed support handover. Confirmation persists both the support request and CRM event atomically. The staff queue exposes the latest 100 messages present at confirmation and minimal contact details, excluding future messages, tool payloads and private document URLs.
- `/plan-budget` and explicit budget messages in Seri provide a BDT cost planner, live adult flight searches, and published package comparisons. Unfilled estimates are excluded. Package exclusions and child-age fare limitations remain visible.
- Booking details separate reservation, received payment, and ticket issuance. Offline summaries omit PNR and names unless the customer chooses to include them. Calendar exports include a 24-hour reminder, preserve offsets, and leave offset-less airport times local. They provide no live delay or gate notifications.
- The language menu persists English/Bangla preferences without remounting booking drafts. Key controls are translated and Seri receives the language preference. Provider text, staff updates, and some descriptive copy retain their original language.

## Support operations

The existing CRM workspace has a new `/b2c-admin/support` panel. Its server proxy signs requests using the existing bridge. Owner, manager, and support staff can access it. Browser code has no staff token or database secret.

API endpoints under `/api/v1`:

- `GET/POST travel/fare-watches`, `DELETE travel/fare-watches/:id`
- `GET travel/support-requests`, `POST travel/support-requests/:id/approve`
- `GET admin/travel/support-requests`, `GET/POST admin/travel/support-requests/:id`

Every quote approval/update includes `expectedVersion`. Expired or changed quotes cannot be approved. Only the customer can move a quote to APPROVED. Staff transitions record audit events and customer-visible history. These actions do not themselves charge, refund, or change an airline booking; staff must perform and verify those operations through the existing provider workflow before posting completion.

## Database

Migration `0029_travel_assistance` adds `fare_watches` and `travel_support_requests`, foreign keys, indexes, row security, and access for the existing restricted API role. It was applied to the shared Flyseri Supabase project through its authenticated SQL Editor after the migration tests passed. No existing customer rows were altered.

`scripts/verify-travel-assistance.cjs` verifies visibility and restricted-role access. `scripts/apply-travel-assistance.cjs` is a focused migration runner for an administrator connection (`DATABASE_MIGRATION_URL`), with the existing URL as fallback; runtime credentials intentionally cannot create tables. Do not reapply the one-time SQL artifact after the migration is recorded.

The web changes remain local. Production requires deploying both the API/customer web and CRM admin, plus an always-running worker or scheduler for dependable price-watch checks.

## Dedicated airline extras step

Passenger checkout now opens `/app/flights/booking-intents/:intentId/extras` before reservation review. The page uses the existing supplier ancillary lookup and server selection endpoints, with category and traveler filters, flight grouping, and a running total. Unavailable services remain unavailable rather than being replaced with sample offers.

Continue preserves selections. Skip clears saved extras only after the server confirms success. Review provides an edit link, and browser Back retains the intent without repeating its initial fare validation. Expired fares must be refreshed before continuing. Selecting extras does not purchase them; airline confirmation and final prices still follow the existing reservation and payment workflow.
