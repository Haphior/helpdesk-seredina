# Seredina

Open source, fully configurable helpdesk + ITSM/ITAM (GLPI-scope: ticketing, asset
management/CMDB, agentless inventory, and more to come) with AI agent integration,
plus NOC/SOC integration via webhook alert ingestion (`POST /v1/alerts` turns a
Zabbix/Wazuh/Grafana/etc. alert into a ticket). Ships as a self-hosted Docker
deployment (single tenant) and as a multi-tenant cloud service — same codebase, same
containers, both modes.

Status: Phase 1 done, Phase 2 in progress (ticketing core, agent console, CMDB +
agentless discovery, NOC/SOC alert ingestion) — see
[docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

- **API**: Node.js/TypeScript, Fastify, Prisma, PostgreSQL (with Row-Level Security for
  tenant isolation)
- **Web**: React, Vite, Tailwind
- **Worker**: BullMQ (Redis) for agentless network discovery, email ingestion, AI
  jobs, SLA timers
- **AI**: pluggable provider adapters (Anthropic first) + a first-class MCP server so
  external agents can operate on tickets/knowledge base under the same guardrails as
  Seredina's own AI
- **License**: AGPL-3.0-only — see [LICENSE](LICENSE)

## Repo layout

```
apps/
  api/          Fastify + Prisma HTTP/WS API — all domain logic lives in src/modules/*/service.ts
  web/          Agent/admin console
  worker/       BullMQ background processors — agentless network discovery today
  mcp-server/   MCP server exposing the same tool catalog as the AI copilot/autonomous modes
packages/
  db/           Prisma schema/migrations/RLS policies + the guarded-client/withTenantTx
                tenant-isolation mechanism -- shared by apps/api and apps/worker,
                not duplicated (see docs/adr/0001-multi-tenancy-rls.md)
  shared/       Cross-app types, zod DTOs, permission constants, CIDR utils
  ui/           Shared React components
  ai-adapters/  LLM provider adapter interface + implementations
  email-parser/ MIME parsing/threading for the email channel
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

# in a third terminal, only if you want agentless discovery working locally
npm run dev --workspace=apps/worker   # needs REDIS_URL + DATABASE_URL set
```

The web app reads its API base URL from `VITE_API_URL` (`apps/web/.env.example`,
default `http://localhost:4000`). The API allows cross-origin requests via
`@fastify/cors`, configurable with `CORS_ORIGIN` (unset = allow-all, fine for local
dev since auth is a Bearer token, never a cookie).

Database schema/migrations/seed now live in `packages/db`, not `apps/api` — run
`npm run prisma:generate|prisma:migrate|prisma:deploy|prisma:seed --workspace=@seredina/db`.

See [docs/adr/](docs/adr/) for the reasoning behind the multi-tenancy, AI, and
agentless-discovery architecture.
