<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Seredina logo">
</p>

<h1 align="center">Seredina</h1>
<p align="center"><b>Open-source ITSM that meets you in the middle.</b></p>

Ticketing, asset management/CMDB, and NOC/SOC alert ingestion — with an AI copilot
that drafts, and a human who approves — in one open-source helpdesk. "Seredina"
(середина) is Slavic for "the middle": email, API calls, and monitoring alerts all
arrive from different places and land in the same ticket.

Run it as a self-hosted Docker deployment or as a multi-tenant cloud service — same
codebase, same containers, your choice. Full source, AGPL-3.0, no separate
"enterprise" fork holding features back.

Status: Phase 1 done, Phase 2 in progress (ticketing core, agent console, CMDB +
agentless discovery, NOC/SOC alert ingestion, AI copilot v1, SLA engine, macros,
custom fields) — see [docs/ROADMAP.md](docs/ROADMAP.md) for what's shipped and
what's next.

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

## Self-hosted deployment

Requires Docker.

```bash
./scripts/setup.sh                              # generates .env with fresh secrets
docker compose -f infra/docker-compose.yml up -d
```

That's the whole install — `migrate` applies the schema/RLS policies and exits,
then `api`/`worker`/`web` start. Visit the web app (`http://localhost:8080` by
default, `WEB_PORT` in `.env`) and register your organization at `/register` —
there's no separate CLI bootstrap step, the same registration flow works
identically in self-hosted and cloud mode.

`./scripts/setup.sh` won't touch an existing `.env` — delete it first if you
want to regenerate secrets from scratch (this invalidates any already-stored
email channel passwords, encrypted with the old `ENCRYPTION_KEY`). See
`.env.example` for what every variable does and which ones are optional
(`ANTHROPIC_API_KEY` for the AI copilot, `SENTRY_DSN` for error tracking).

If a container fails to become healthy, `docker compose -f
infra/docker-compose.yml logs api` (or `worker`) is the first place to look —
`apps/api`/`apps/worker` both validate every required env var at startup and
report everything missing/malformed in one message, rather than crashing on
the first one and forcing a fix-restart-discover-the-next-one loop.

## MCP server (connect your own AI agent)

`apps/mcp-server` exposes the same tool catalog the AI copilot uses (get/reply/
status/assign/macro/escalate on tickets) to *your own* MCP-compatible agent
(Claude Desktop, an n8n workflow, a custom script). Two transports, picked
with `MCP_TRANSPORT` (default `stdio`):

**stdio** — a separate process from `api`/`worker`, not part of a plain
`docker compose up`. A client spawns it per-session and owns its
stdin/stdout directly, the same way Claude Desktop spawns any other local
MCP server. The tenant is resolved once at startup from `SEREDINA_API_KEY`.

1. Create an API key from Settings → API Keys in the web app.
2. Build the image: `docker build -f infra/docker/Dockerfile.mcp-server -t seredina-mcp-server .`
3. Point your MCP client at `docker run -i --rm -e SEREDINA_API_KEY=<your key> -e DATABASE_URL=... -e ENCRYPTION_KEY=... seredina-mcp-server` (or run `apps/mcp-server` directly with `tsx`/`node` in development — see `apps/mcp-server/package.json`'s `dev` script).

**http** — a genuine always-on network service (Streamable HTTP,
deliberately stateless — see `docs/adr/0035-mcp-http-transport.md`), for a
remote or long-running agent instead of a locally-spawned one. Each request
carries its own `Authorization: Bearer <ApiKey>` header; the tenant is
resolved fresh per request, never cached server-side. Run it with
`docker compose --profile mcp up mcp-server-http` (profile-gated — a plain
`docker compose up` never starts it), or set `MCP_TRANSPORT=http` when
running `apps/mcp-server` directly.

Every mutating tool call is gated by that tenant's Autonomy Policy (Operations
→ AI Agent Activity in the web app): tools not on the auto-execute allow-list
wait there for a human to approve or reject, and every call — auto-executed
or not — is logged to the same audit trail. See
`docs/adr/0033-ai-tool-catalog-and-autonomy.md`.

## Embeddable chat widget

Drop this on any page of your own website — no login, no API key, works
from any domain:

```html
<script src="https://<your-seredina-instance>/widget.js" data-tenant="<your-tenant-slug>"></script>
```

A visitor gets a floating chat bubble; the conversation lands in Seredina
as a normal ticket (`channel: "widget"`) that agents reply to like any
other. Continuity across page loads/visits is via a random token the
visitor's browser holds in `localStorage`, not a login — see
`docs/adr/0040-embeddable-widget.md` for how that's scoped safely and how
its cross-origin CORS is handled without weakening this API's normal CORS
lockdown.

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
