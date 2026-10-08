# Holiday packages

## Customer routes

- `/holidays`: Bangladesh and international catalogue, sourced from published admin packages.
- `/holidays/:id`: itinerary, inclusions, exclusions, cancellation policy, available departure dates, adult/child quantities, and a BDT total.
- `/holidays/bookings`: signed-in customer's booking requests and confirmation status.

The homepage replaces Travel inspiration with this catalogue. The Packages service links to it on desktop, tablet and mobile.

## Admin

The existing CRM at `http://localhost:3095/b2c-admin/holidays` has a Holiday Packages panel. Owner and manager roles can create/edit packages, publish/unpublish them, and confirm or decline requests. The existing staff bridge signs all API calls server-side; no service secrets are added to browser code.

CRM source changes are in `components/b2c/holiday-packages-panel.tsx`, `components/b2c/admin-workspace.tsx`, `components/dashboard/sidebar-nav.tsx`, `lib/b2c/permissions.ts`, and `app/api/b2c/[...path]/route.ts` in the separate Whatsapp_CRM_Seri_Mechan checkout. The staged component in `artifacts/holiday-admin` is a copy for review, not a runtime dependency.

## Database activation

Apply migration `packages/database/drizzle/0028_holiday_packages.sql` with the normal Drizzle migration runner as database administrator and rerun the application role grants in `supabase/flyseri-api-role.sql`. Alternatively, the focused transaction `artifacts/holiday-admin/database-update.sql` creates the two tables, grants only their access to `flyseri_api`, and records the migration in the existing Drizzle database journal. Do not run both alternatives on the same database.

The currently configured `flyseri_api` account cannot create tables. No production database was changed while implementing this feature. Until activation, the API returns a setup-pending 503 and the admin displays that message. Development-only examples appear with explicit preview labels and disabled booking buttons. Production builds include no sample catalogue fallback.

## Booking and purchasing boundary

A signed-in customer chooses a published package, future departure date, adults and children, reviews contact details and policy, then submits a booking request. The server calculates the price using integer minor units and stores the package, price and contact snapshot. Client totals are never accepted. Version checks reject changed prices; idempotency keys prevent duplicate retries. Requests are private to the customer; owner/manager staff can process them with an audit trail.

`PENDING_CONFIRMATION` is not a reservation, payment, or inventory hold. Confirmed means staff confirmed availability, not that payment was received. This flow does not charge a card or send emails. Actual package payment integration remains to be configured; the UI communicates that payment arrangements follow staff confirmation. Pax maximum limits each request, not package seat inventory. Adult age is 12+, child age is 2–11; infants require staff assistance.

## API

- Public: `GET /api/v1/holidays`, `GET /api/v1/holidays/:id`.
- Customer: `GET /api/v1/holidays/bookings`, `POST /api/v1/holidays/bookings`.
- Staff (owner/manager): `GET/POST /api/v1/admin/holidays`, `POST /api/v1/admin/holidays/:id`, `GET /api/v1/admin/holidays/bookings`, `POST /api/v1/admin/holidays/bookings/:id/status`.

Admin input uses the HolidayPackage contract without `id` or `preview`; new packages use version 0 and updates send the loaded version. Each itinerary entry represents one day. Unpublishing retains earlier booking snapshots. All package prices are inclusive of the mandatory charges described by staff and use BDT.
