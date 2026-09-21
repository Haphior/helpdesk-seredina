<p align="center">
  <img src="apps/web/public/favicon.svg" width="84" height="84" alt="Seredina logo">
</p>

<h1 align="center">Seredina</h1>
<p align="center"><b>Open-source ITSM that meets you in the middle.</b></p>
<p align="center">
  <a href="https://github.com/Haphior/helpdesk-seredina/actions/workflows/ci.yml"><img src="https://github.com/Haphior/helpdesk-seredina/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
</p>

Ticketing, asset management/CMDB, and NOC/SOC alert ingestion — with an AI copilot
that drafts, and a human who approves — in one open-source helpdesk. "Seredina"
(середина) is Slavic for "the middle": email, API calls, and monitoring alerts all
arrive from different places and land in the same ticket.

Run it as a self-hosted Docker deployment or as a multi-tenant cloud service — same
codebase, same containers, your choice. Full source, AGPL-3.0, no separate
"enterprise" fork holding features back.

**Full documentation**: **[haphior.github.io/helpdesk-seredina](https://haphior.github.io/helpdesk-seredina/)**
— user guide (every feature, from the console's point of view), deployment/
hosting reference, and the API/webhooks/MCP-server integration reference.
Source lives in `apps/docs/`, built with [VitePress](https://vitepress.dev)
and deployed via `.github/workflows/docs.yml`.

Status: Phases 0-5 done (multi-tenant ticketing core, SLA + macros + service
catalog + change/problem/release management, AI copilot with autonomous mode and
an MCP server, cloud hardening, Slack/Teams/Telegram/Zabbix integrations, and a
real endpoint agent for hardware/software inventory), plus a first pass of
console internationalization (English + Spanish) — see
[docs/ROADMAP.md](docs/ROADMAP.md) for the full breakdown of what's shipped,
what's disclosed-but-deferred, and what's still backlog.

## Stack

- **API**: Node.js/TypeScript, Fastify, Prisma, PostgreSQL (with Row-Level Security for
  tenant isolation)
- **Web**: React, Vite, Tailwind
- **Worker**: BullMQ (Redis) for agentless network discovery, outbound email/
  webhook/notification delivery, and SLA escalation timers; a plain interval
  loop for inbound email polling (see docs/adr/0004-email-channel.md for why
  that one isn't BullMQ too)
- **AI**: pluggable provider adapters (`packages/ai-adapters`; Anthropic and
  OpenAI implemented, plus a local Ollama option — bring your own key, or unset
  it entirely and the feature 503s cleanly) power a copilot (suggest-reply/
  summarize on a ticket), a full autonomous tool-use loop gated by a per-tenant
  Autonomy Policy (mutating actions need human approval unless explicitly
  allow-listed), and `apps/mcp-server` (stdio + Streamable HTTP) so an external
  agent can operate on tickets/knowledge base under the same guardrails — see
  docs/adr/0005-ai-copilot.md and docs/adr/0033-ai-tool-catalog-and-autonomy.md
- **License**: AGPL-3.0-only — see [LICENSE](LICENSE)

## Repo layout

```
apps/
  api/          Fastify + Prisma HTTP/WS API — all domain logic lives in src/modules/*/service.ts
  web/          Agent/admin console
  worker/       Discovery + email (IMAP poll, SMTP send) background processing — src/email/, src/discovery/
  mcp-server/   MCP server exposing the same tool catalog as the AI copilot/autonomous modes
  docs/         User guide + deployment + API reference (VitePress), deployed to GitHub Pages
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

Every commit needs a `Signed-off-by` trailer (the
[Developer Certificate of Origin](DCO.md), not a copyright transfer) — commit
with `git commit -s` and CI checks it automatically on every pull request. See
[DCO.md](DCO.md) for the full text and how to fix a commit that's missing one.
Please also read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md); security issues go
through [SECURITY.md](SECURITY.md)'s private reporting flow, never a public
issue.
