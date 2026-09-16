# Seredina

Open source, fully configurable helpdesk + ITSM/ITAM (GLPI-scope: ticketing, asset
management/CMDB, agentless inventory, and more to come) with AI agent integration,
plus NOC/SOC integration via webhook alert ingestion (`POST /v1/alerts` turns a
Zabbix/Wazuh/Grafana/etc. alert into a ticket). Ships as a self-hosted Docker
deployment (single tenant) and as a multi-tenant cloud service — same codebase, same
containers, both modes.

Status: Phase 1 done, Phase 2 in progress (ticketing core, agent console, CMDB +
agentless discovery, NOC/SOC alert ingestion, AI copilot v1) — see
[docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

- **API**: Node.js/TypeScript, Fastify, Prisma, PostgreSQL (with Row-Level Security for
  tenant isolation)
- **Web**: React, Vite, Tailwind
- **Worker**: BullMQ (Redis) for agentless network discovery and outbound email
  send; a plain interval loop for inbound email polling (see
  docs/adr/0004-email-channel.md for why that one isn't BullMQ too); AI jobs, SLA
  timers still to come
- **AI**: pluggable provider adapters (`packages/ai-adapters`; Anthropic implemented,
  optional — unset `ANTHROPIC_API_KEY` and the feature 503s cleanly) power a v1
  copilot (suggest-reply/summarize on a ticket, human approves — see
  docs/adr/0005-ai-copilot.md); autonomous mode and a first-class MCP server so
  external agents can operate on tickets/knowledge base under the same guardrails
  are still Phase 3
- **License**: AGPL-3.0-only — see [LICENSE](LICENSE)

## Repo layout

```
apps/
  api/          Fastify + Prisma HTTP/WS API — all domain logic lives in src/modules/*/service.ts
  web/          Agent/admin console
  worker/       Discovery + email (IMAP poll, SMTP send) background processing — src/email/, src/discovery/
  mcp-server/   MCP server exposing the same tool catalog as the AI copilot/autonomous modes
packages/
  db/           Prisma schema/migrations/RLS policies + the guarded-client/withTenantTx
                tenant-isolation mechanism -- shared by apps/api and apps/worker,
                not duplicated (see docs/adr/0001-multi-tenancy-rls.md)
  shared/       Cross-app types, zod DTOs, permission constants, CIDR/crypto/queue-contract utils
  ui/           Shared React components
  ai-adapters/  LLM provider adapter interface + implementations
  config/       Shared tsconfig/eslint
infra/          Dockerfiles, docker-compose.yml
docs/           Roadmap, architecture decision records
```

## Development

Requires Docker (for Postgres + Redis) and Node.js 20+ (Fastify 5 / `@fastify/jwt` 10
require it — this repo was bumped off Node 18 during Phase 0 specifically to avoid
shipping known-critical CVEs in the older `fastify`/`fast-jwt` majors).

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres redis
npm run dev:api

# in a second terminal
npm run dev --workspace=apps/web   # http://localhost:5173, expects the API on :4000

# in a third terminal, only if you want discovery/email working locally
npm run dev --workspace=apps/worker   # needs REDIS_URL + DATABASE_URL + ENCRYPTION_KEY set
```

The web app reads its API base URL from `VITE_API_URL` (`apps/web/.env.example`,
default `http://localhost:4000`). The API allows cross-origin requests via
`@fastify/cors`, configurable with `CORS_ORIGIN` (unset = allow-all, fine for local
dev since auth is a Bearer token, never a cookie).

Database schema/migrations/seed now live in `packages/db`, not `apps/api` — run
`npm run prisma:generate|prisma:migrate|prisma:deploy|prisma:seed --workspace=@seredina/db`.

See [docs/PRD.md](docs/PRD.md) for the consolidated product requirements
(problem/ICP/scope/risks in one place), [docs/adr/](docs/adr/) for the reasoning
behind the multi-tenancy, AI, and agentless-discovery architecture,
[docs/PRODUCT.md](docs/PRODUCT.md) for the full ICP/pain/value detail,
[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) for the UI's typography/color/
component conventions, and [docs/BRAND.md](docs/BRAND.md) for the name/logo/voice.

Error tracking (`apps/api`, `apps/worker`, `apps/web`) is wired via the Sentry SDK
but no-ops until `SENTRY_DSN`/`VITE_SENTRY_DSN` is set — point it at Sentry.io or a
self-hosted [GlitchTip](https://glitchtip.com/) instance (protocol-compatible),
whichever fits your deployment.

## Contributing

Commit small and often: one focused change per commit (a schema migration, a
route, a UI pass on one screen) rather than batching a whole feature into one
commit. Easier to review, `git bisect`, and revert. This wasn't followed
consistently early on (Phase 0/1 commits are large, feature-sized) — new work
should do better, not match that precedent.
