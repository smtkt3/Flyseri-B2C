# Fly Seri B2C Admin integration

The operational UI remains at `http://localhost:3095/b2c-admin` inside the existing Seri Mechan CRM. It reads Flyseri data through the CRM server route `/api/b2c/*`, which calls Flyseri's `/api/v1/admin/*`. The browser receives neither database credentials nor the service signing secret.

## Server configuration

- Flyseri API: `B2C_ADMIN_SHARED_SECRET` (at least 32 random characters), `DATABASE_URL`, and existing storage configuration when document content access is needed.
- CRM server: the **same** `B2C_ADMIN_SHARED_SECRET` and `FLYSERI_API_URL` (HTTPS in deployed environments; local HTTP is restricted to localhost).
- CRM's existing Supabase staff configuration must be present. The bridge requires both an active staff profile with the signed CRM role and a matching verified Supabase Auth user. Demo sessions cannot access Flyseri admin data.
- Apply the Flyseri Drizzle migrations through `0020_visa_history_status_length.sql` before enabling the Phase 10.75 visa service. Keep migrations on an administrator connection, then run `supabase/flyseri-api-role.sql` as the project administrator to grant the restricted API role access to the new tables.

### Local Supabase project (2026-09-24)

This checkout is linked with the Supabase CLI to project `jkgkpgdwzuxletrmseqv`. The nine existing Drizzle migrations were applied as one transaction and recorded in `drizzle.__drizzle_migrations`; all 17 Flyseri tables in `public` have row-level security enabled. The private `travel-documents` bucket exists with the application's 10 MB and PDF/JPEG/PNG limits. Drizzle remains the migration source of truth; the Supabase CLI migration list is not used for these migrations.

On 2026-09-30, the project dashboard identified this project as `main PRODUCTION`. With user approval, migrations 0013–0017 were applied and recorded in `drizzle.__drizzle_migrations`; the API role grants were updated. A read-only connection as `flyseri_api` confirmed that it can read `flight_bookings` and insert `guest_flight_checkout_attempts`. Both tables had zero records at that check. The Git-ignored root `.env` contains the API's restricted Postgres URL and server-only keys. The CRM staff Supabase configuration is separate: this Flyseri project's `public` schema has no CRM `profiles` table. Never commit `.env` or paste database and server keys into chat.

CRM mints a 60-second HMAC-signed server-to-server token with staff user ID and CRM role. Flyseri verifies the signature, issuer, audience, expiry, and role, then enforces permissions on each admin endpoint. Customer bearer tokens cannot call admin endpoints. No Flyseri entities are copied into CRM tables.

## Current scope

Dashboard metrics and activity come from Flyseri PostgreSQL. Customer, traveller, trip, visa, document, and staff-audit lists are paginated. Customer and trip detail pages link to related records. Document metadata is available to authorized roles; only the owner role can request a short-lived signed URL for a specific uploaded version. URL issuance is audited without recording the URL or storage path.

## Visa processing API (Phase 10.75)

The Flyseri API now supports the operational endpoints below. The external CRM server must proxy these paths through its existing authenticated `/api/b2c/*` bridge; the CRM UI and bridge source are not in this repository, so they still need to be wired and visually tested in that application.

- `GET /api/v1/admin/visa` returns a paginated low-PII queue with application reference, customer/applicant names, country/type, created/submitted dates, payment/order status, required-document progress, and open correction counts. Search matches reference, application UUID, customer, applicant, visa type, and country code. Filters support status, payment status, inclusive creation date bounds (`createdFrom`/`createdTo`), and `actionRequired`.
- `GET /api/v1/admin/visa/:id` returns the compact record. `GET /api/v1/admin/visa/:id/processing` returns form answers, document checklist, payment details, timeline, requests, and notes and requires the separate `visa_pii` permission.
- `PATCH /api/v1/admin/visa/:id/requirements/:requirementId/review` supports review/acceptance/replacement decisions. Acceptance requires an uploaded, `CLEAN` version linked to that application and applicant. `GET /api/v1/admin/visa/:id/documents/:documentId/versions/:versionId/access` issues a short-lived audited link only for an exact application-linked version.
- `POST /api/v1/admin/visa/:id/requests`, `POST /api/v1/admin/visa/:id/notes`, and `PATCH /api/v1/admin/visa/:id/status` support customer corrections, internal/customer updates, and controlled status transitions. Staff cannot set payment success through the status endpoint.
- `POST /api/v1/admin/visa/services`, `POST /api/v1/admin/visa/services/:visaTypeId/versions`, and `POST /api/v1/admin/visa/services/:visaTypeId/requirements` configure versioned service/form snapshots and conditional document requirements. A published service must have a non-empty form, verified processing text, and a positive fee total.

Owner/manager staff have visa PII and configuration access. Support staff can use the compact visa queue and manage updates, but cannot open PII-heavy processing detail or configure services. Payment status comes from Phase 7 payment records and verified provider events.

The admin dashboard returns visa counts by operational category (awaiting payment, paid, document review, action required, submitted for authority processing, approved/issued, rejected, and completed). The existing `visaApplicationsSubmitted` metric remains a distinct submitted-application count; payment state is never inferred from application status.

There is no document-bundle/export endpoint yet. The API provides secure per-version document access. A malware scanner is not configured in this environment; uploaded versions remain `UNAVAILABLE`, cannot be accepted, and block customer submission. No visa services or embassy requirements are seeded as live data.

The Flights panel lists server-persisted guest checkout submissions and Sabre booking attempts separately. Guest rows show contact, passenger names, route, shopping fare, and submission time. They have no PNR, payment, or ticket status. Booking rows show the stored PNR if Sabre returned one, reservation status, order/payment status, and verified paid time. Authorized staff can refresh a stored PNR with GetBooking; a record without a locator cannot be refreshed this way. The CRM server bridge targets the local Flyseri API at `http://localhost:3001` during development. Staff access remains permission guarded.

Flight metrics are the actual counters from the current Flyseri API process. They reset on restart; daily totals and per-search history are not persisted, so the UI labels the measurement window. Staff cannot create a PNR or mark a booking paid or ticketed from this dashboard. Payment provider integration remains unavailable. The prior CERT CreateBooking attempt returned an ambiguous result without a locator and must be reconciled in Sabre before any retry.

## Verification boundary

Automated tests cover token validation, role restrictions, pagination and real-schema queries, document-version matching, signed URL audit, guest submission idempotency, and booking/payment projections. Local CRM routing redirects unauthenticated visits to its staff login. A real staff session is still needed to visually verify the end-to-end dashboard; do not use a customer account as a staff substitute.
