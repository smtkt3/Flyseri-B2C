# Flyseri workspace

- `apps/customer-web` is the approved React/Vite/Tailwind visual baseline. Preserve its styling and responsive behavior.
- `apps/api` is the NestJS API. It owns server configuration, validation, logging, and infrastructure access.
- `packages/types`, `config`, `logging`, `database`, and `redis` are shared foundations.
- Demo content in `apps/customer-web/src/data/demo` and `src/services/demo` is illustrative and must never be presented as live availability.
- Keep server credentials outside browser code and `VITE_*` variables.
- Phase 1 has no Sabre, booking, payment, CRM, AI provider, authentication, or document integration.
