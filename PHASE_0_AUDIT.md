# Flyseri customer platform: Phase 0 audit

Audited 23 September 2026. The supplied `Flyseri Travel Companion App.zip` has been imported unchanged as the frontend baseline. The separate pasted platform brief describes desired behavior; it is not evidence that any integration already exists.

## A. Current architecture

- Single React 19 and TypeScript 5.7 application built with Vite 8 and Tailwind CSS 4.
- `pnpm-lock.yaml` is the package manager lockfile. Node 24 is specified in `.mise.toml`.
- One HTML entry point mounts one `App` component. There is no server, worker, monorepo, or shared package structure.
- `.figma/make/*` and custom plugins in `vite.config.ts` are Figma Make tooling and deployment helpers, not customer platform services.

## B. Frontend structure

- `src/App.tsx` contains the whole page: content arrays, search forms, mock results, mobile and desktop navigation, cards, overlays, and chat. It is about 2,400 lines and 138 KB.
- `src/index.css` contains global styling and responsive rules. Image assets are in `src/assets` and `src/imports`; many displayed photos load from Unsplash.
- Public landing sections include flights, hotels, tours, eSIM, bundles, destinations, attractions, testimonials, and Seri marketing. There is no route library or authenticated customer workspace.
- Form inputs use local React state. The manual search button has no search action. The AI search opens a timed results overlay containing hard-coded flight, hotel, and extras arrays.
- The chat returns fixed responses after a timer. Several navigation and sign-in buttons have no implemented destination.

## C. Sabre integration

None. There are no Sabre dependencies, credentials, API clients, requests, response types, price validation, or booking flows. The sample flight prices and availability copy are hard-coded. They must not be represented as live or bookable when this UI is connected to production.

## D. API and backend

None. There are no API routes, network requests for product data, backend services, validation schemas, logging, or request IDs. Unsplash image requests are the only external browser requests found in application code.

## E. Authentication

None. The sign-in control is presentational. There is no session, account, role, or ownership enforcement.

## F. Database and storage

None. There are no migrations, database client, Supabase configuration, private document storage, or upload flows.

## G. Redis

None. There is no cache, queue, lock, rate limiter, or idempotency implementation.

## H. AI

Presentational only. `SearchPanel`, `SeriResults`, and the chat widget simulate AI behavior with local state, static data, and timeouts. No model API or controlled tools exist.

## I. CRM integration

None. No Seri Mechan CRM endpoint or contract was supplied in this repository. Integrate through a typed adapter once its actual contract is available; do not create a duplicate CRM.

## J. Main risks and technical debt

1. Hard-coded offers, prices, seat counts, service statistics, ratings, and testimonials can imply verified live information even though the UI is a demo.
2. A large `App.tsx` mixes page presentation, sample data, forms, and state, making integrations difficult to add safely.
3. The manual search button is inert; chat and AI search appear functional but return canned responses.
4. There is no customer identity, resource authorization, server-side secrets boundary, data persistence, or API input validation.
5. There are no test, lint, or typecheck scripts. `tsconfig.json` does enable strict TypeScript, but `vite build` alone does not typecheck.
6. Photos depend on a third-party host. The imported design and responsive CSS need visual verification before restructuring.

## K. Files and modules to change first

1. `src/App.tsx`: extract stable UI components and mock data without changing the design, then replace simulated search/chat behavior only when matching APIs exist.
2. `src/index.css`: retain the existing visual identity while supporting extracted components and later authenticated views.
3. `package.json`: add explicit typecheck, lint, and test commands as those tools are introduced.
4. `vite.config.ts`: review Figma-specific tooling and define a production API boundary without exposing credentials in browser environment variables.
5. New `src/lib/api` and `src/types` modules: typed frontend contracts for customer, traveller, trip, search, and error states, based on real backend contracts.
6. New backend and migration directories only after runtime, deployment, and existing service contracts are confirmed.

## L. Proposed sequence

1. Preserve this imported frontend as the customer-facing design baseline. Verify it at desktop and phone widths when dependencies are available.
2. Establish repository checks and a typed browser-to-backend API layer. Label demo data clearly during transition.
3. Add backend configuration, validation, request IDs, logging, PostgreSQL migrations, and authentication/ownership checks.
4. Implement customers, travellers, then trip APIs and a trip workspace using the existing Flyseri styling.
5. Add private documents and visa workflows with auditable status changes.
6. Connect flight search through a server-side Sabre adapter using the actual BFM v5 contract. Add Redis cache, coalescing, rate limits, and provider telemetry. Keep final fare validation separate from search cache.
7. Add orders and payments only against an actual provider contract, then CRM event delivery against the existing CRM contract.
8. Connect Seri to controlled, trip-scoped backend tools after the underlying customer and trip data exists.

## Verification and missing inputs

- Source archive inventory and all application/configuration files were inspected. The imported source is unchanged.
- The first offline install failed because packages were absent from the local cache and registry access was restricted. A subsequent permitted `pnpm install --frozen-lockfile --fetch-retries=0` succeeded without changing the lockfile. `pnpm build` and `node .\node_modules\typescript\bin\tsc --noEmit` both passed. The local Vite page returned HTTP 200 at `http://localhost:8443/`. Visual checks are still pending.
- Required before external integration: Sabre BFM v5 credentials and permitted workflow documentation, the existing Seri Mechan CRM API contract, chosen payment provider contract, Supabase project and deployment configuration, and operational decisions for document scanning and AI provider. No external contract has been invented here.
