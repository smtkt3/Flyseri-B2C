# Vercel deployment

Project: `smtkt3-6118/flyseri-b2c`

Public test site: https://flyseri-b2c-murex.vercel.app

GitHub `main` deploys automatically. The site currently uses development settings,
Sabre CERT and Stripe test credentials. It is not a live ticket-sales environment.

## Build and routing

- `vercel.json` defines the API and customer web services on one domain.
- The API service root is the repository root. pnpm stores runtime dependencies
  and shared workspace packages there; limiting the root to `apps/api` omitted
  dependencies from the deployed function.
- The API entrypoint is `apps/api/src/main.mts`. Its explicit Express adapter
  import lets dependency tracing include Nest's otherwise dynamically loaded adapter.
- `PORT` takes precedence over the local `API_PORT` setting.
- `/api/*` routes to the API; customer routes use the Vite SPA fallback.
- The database CA is included in the function. The cloud database URL uses
  `sslmode=verify-full&sslrootcert=certs/supabase-root-2021.crt`; a developer's
  absolute Windows certificate path cannot be used in the cloud.

## Environment

Private configuration is stored as Vercel Secret variables. Only the Supabase
public URL/key and Stripe publishable test key use `VITE_*` Config variables.
Never commit `.env` or introduce private values into the frontend bundle.

`WEB_ORIGIN` must match the public site. Add the deployed reset-password URL to
Supabase's permitted redirects before testing password-reset emails.

Hosted Redis must be reachable over TLS for shared shopping sessions, supplier
tokens, and rate limits. A local `127.0.0.1` Redis instance is not reachable from
Vercel. Configure its standard Redis connection string as server-only `REDIS_URL`.

`flyseri-test-cache` is connected through the Upstash integration using the Free
plan in Singapore (`sin1`, 500,000 monthly commands). The integration supplies
server-only `REDIS_URL` to this project's deployed test environment. No paid plan
was selected. Cache eviction is disabled so durable operation locks are not
silently removed to make space.

Every environment change requires a redeployment.

## Verification

- `GET /api/v1/health`: API startup and routing.
- `GET /api/v1/health/ready`: database and Redis connections; inspect each
  dependency status because optional unconfigured dependencies do not fail liveness.
- Open `/sign-in` directly: authentication form loads with public Supabase config.
- Run a future-dated flight search: supplier availability and session storage.
- Use an authorized test account for authenticated traveller and checkout flows.

Ticket issuance remains gated on the approved Sabre non-cash settlement/printer
profile. See [CERT activation](sabre/CERT_TICKETING_ACTIVATION.md) and
[airline extras status](../AIRLINE_EXTRAS_STATUS.md). A successful deployment or
Stripe test payment does not establish a successful airline ticket/EMD issuance.

Stripe test webhook `we_1UNlsSJz7MtPYNQ37B858ovz` is enabled at
`https://flyseri-b2c-murex.vercel.app/api/v1/payments/webhooks/stripe`
with its server-only signing secret in Vercel. It subscribes to Checkout Session
completion, asynchronous payment success/failure, and expiration, using API
version `2025-06-30.basil` to match the application provider.
