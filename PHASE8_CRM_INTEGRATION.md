# Phase 8 CRM integration

Flyseri PostgreSQL owns B2C accounts, travellers, trips, visa applications, document metadata, flight selections, orders, payments and their activity. The existing Seri Mechan CRM owns contacts, staff, notes, tasks and sales workflows. CRM B2C Admin reads Flyseri through the existing signed admin API bridge. No second CRM or duplicate B2C customer/payment tables were added.

## Delivery

Migration `0012_dazzling_ultimatum.sql` adds only customer↔CRM contact references and a PostgreSQL event outbox. Triggers enqueue allowlisted ID-only events in the same transaction as Flyseri customer, audit and commerce writes. The standalone `crm:sync-worker` claims due events with `FOR UPDATE SKIP LOCKED`, signs an 8-second request to the existing CRM, and marks it delivered only after a successful response. Redis is not the queue authority: this checkout has Redis utilities but no BullMQ worker, and CRM downtime must not affect customer transactions.

Retries wait 1 minute, 5 minutes, 15 minutes and 1 hour. The fifth failed attempt becomes `DEAD`; a crashed lease can be reclaimed. Owner/manager can inspect safe error categories and requeue a dead event. Neither the API nor worker sends document bytes, signed URLs, passports, payment credentials or webhook payloads.

CRM migration `202609270001_flyseri_event_ingest.sql` adds an event receipt table and a single atomic RPC. The HMAC signed receiver checks a 60-second timestamp window. The RPC deduplicates by event ID, writes system activity separately from staff notes, and creates tasks only for visa creation, document submission and payment reconciliation. Task completion does not change Flyseri state. Repeated delivery creates no duplicate task or activity.

## Contact links and staff access

CRM owner/manager gets exact-phone contact suggestions; no match is linked automatically. The CRM server verifies a chosen contact exists and signs a short-lived contact proof. Flyseri Admin API checks that proof and the staff role before recording one active link per customer/contact. Unlink is soft and audited; neither system's customer is deleted. CRM B2C detail links to its existing contact screen, and a linked CRM contact can open the Flyseri B2C profile. Document content still requires the existing owner-only signed URL API and audit.

The CRM bridge uses its existing 60-second HMAC staff token and verified Supabase staff session. Customer browser tokens cannot call admin endpoints. The CRM service key and both HMAC secrets remain server-only. CRM B2C Admin displays aggregate order/payment counts, sync status, failed jobs, customer activity and read-only authoritative order/payment data.

## Rollout

1. Apply Flyseri migration `0012` as database owner, record its hash in `drizzle.__drizzle_migrations`, then run `scripts/grant-flyseri-crm-sync.sql` for the existing server-only `flyseri_api` role.
2. Apply the CRM Supabase migration in the **CRM's own project**. Do not apply it to Flyseri's Supabase project.
3. Configure the same `B2C_ADMIN_SHARED_SECRET` on Flyseri API and CRM server. Configure a separate `CRM_SYNC_SHARED_SECRET` on both servers, plus Flyseri `CRM_SYNC_URL` and CRM `FLYSERI_API_URL`. Use HTTPS outside localhost. Keep these out of `VITE_*`.
4. Run the Flyseri API and a separate `pnpm --filter @flyseri/api crm:sync-worker` process. Supervise and restart the worker like any other background service.
5. Sign in with a verified CRM staff account and verify dashboard, customer link, activity, integration status and retry. Test a CRM outage and restoration before deploying.

## Verified local state · 27 September 2026

- Flyseri Supabase project `jkgkpgdwzuxletrmseqv`: migration `0012` and the scoped `flyseri_api` grants were applied. The migration hash is recorded; both tables and the required role privileges were confirmed with read-only SQL.
- Existing CRM Supabase project `dyzvptlpirfxhicemkfl`: the event receipt/RPC migration was applied. RLS is enabled; `service_role` can execute the ingest function and `authenticated` cannot.
- Matching random HMAC secrets, the CRM publishable key, and the CRM server key are in ignored local environment files. They are not in browser code or the repository. Local CRM staff sign-in and the signed Flyseri Admin API bridge were verified. The CRM's event receiver rejects unsigned requests; a correctly signed request reached the RPC and a deliberately nonexistent contact was rejected without creating a receipt.
- The CRM middleware explicitly permits the one HMAC-protected event receiver path. All other protected API paths still require a verified staff session.
- B2C Admin rendered real aggregate counts, a real customer and planning trip, the integration status panel, and truthful empty visa/document/order/payment lists. The customer timeline reads historical Flyseri audit events plus post-migration commerce activity, without copying records into CRM tables.
- A later local CRM session lacked a Supabase staff access token, so the B2C screen correctly switched to “Verified staff access required.” Local demo credentials cannot operate the B2C bridge. Sign in again with a real CRM Supabase staff account for continued interactive verification.
- CRM now renews an expired Supabase access token from its HttpOnly refresh cookie on B2C routes, after checking the refreshed user ID against the authenticated session. Demo login clears any stale Supabase credentials instead of inheriting a previous staff identity.
- The requested CRM manager email already had an active, confirmed Supabase Auth user linked to an active manager profile; no duplicate user was created. An authorized password recovery email was sent and a local `/reset-password` page let the user set a private password. A fresh real manager sign-in showed numeric B2C overview counts, the signed integration panel, and the Flyseri customer timeline. The demo login remained denied.
- The local CRM worker is running, and the live queue currently has zero events. Delivery, CRM outage, retry and dead-letter behavior passed isolated PostgreSQL tests. There was no genuine new customer event to deliver in the live project during verification, so a successful live outbound delivery remains unobserved.
- In the final verified manager session, Overview showed one active customer, zero active trips and six historical activity items; CRM Integration showed zero pending, failed and delivered events. The customer detail showed no CRM contact link and no exact phone suggestion, because that profile has no phone. At 611px and 1265px content widths the page had no document-level horizontal overflow; the section tabs scroll within their own strip.
- Final checks after the recovery and renewal changes: Flyseri API tests 74/74 with one file at a time, Flyseri build/lint, CRM typecheck/lint and CRM production build passed. The default parallel PGlite API run timed out in five files under resource contention; those same files passed in the serialized full run.

Local configuration does not deploy server secrets or start the worker in a hosted environment. Before any hosted rollout, configure the same secrets in both server environments, deploy the CRM receiver and Flyseri API, supervise the worker, then verify a genuine event from an authorized test customer. Phase 9 AI integration is not implemented. A future `support.handoff.requested` event can be added to the allowlist after its payload and staff workflow are defined.
