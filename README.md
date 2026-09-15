# Seredina

Open source, fully configurable, AI-agent-integrated helpdesk. Ships as a self-hosted
Docker deployment (single tenant) and as a multi-tenant cloud service — same codebase,
same containers, both modes.

Status: Phase 1 in progress (ticketing core backend + agent console) — see
[docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

- **API**: Node.js/TypeScript, Fastify, Prisma, PostgreSQL (with Row-Level Security for
  tenant isolation)
- **Web**: React, Vite, Tailwind
- **Worker**: BullMQ (Redis) for email ingestion, AI jobs, SLA timers
- **AI**: pluggable provider adapters (Anthropic first) + a first-class MCP server so
  external agents can operate on tickets/knowledge base under the same guardrails as
  Seredina's own AI
- **License**: AGPL-3.0-only — see [LICENSE](LICENSE)

## Repo layout

```
apps/
  api/          Fastify + Prisma HTTP/WS API — all domain logic lives in src/modules/*/service.ts
  web/          Agent/admin console
  worker/       BullMQ background processors
  mcp-server/   MCP server exposing the same tool catalog as the AI copilot/autonomous modes
packages/
  shared/       Cross-app types, zod DTOs, permission constants
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
```

The web app reads its API base URL from `VITE_API_URL` (`apps/web/.env.example`,
default `http://localhost:4000`). The API allows cross-origin requests via
`@fastify/cors`, configurable with `CORS_ORIGIN` (unset = allow-all, fine for local
dev since auth is a Bearer token, never a cookie).

See [docs/adr/](docs/adr/) for the reasoning behind the multi-tenancy and AI architecture.
