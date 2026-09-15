# Seredina Roadmap

Open source, fully configurable, multi-tenant helpdesk with pluggable AI agent
integration (copilot, autonomous, and an open MCP framework for external agents).
Self-hosted via Docker (single tenant) and cloud (multi-tenant) from one codebase.
AGPL-3.0-only.

## Phase 0 — Foundations ✅ (this pass)

- Monorepo scaffold (npm workspaces): `apps/api`, `apps/web` (placeholder), `apps/worker`
  (placeholder), `apps/mcp-server` (placeholder), `packages/shared`, `packages/config`.
- PostgreSQL + Prisma; `Tenant`/`User`/`Role`/`Permission`/`RolePermission` schema.
- Multi-tenancy mechanism proven end to end: `tenant_id` + Postgres RLS (`FORCE ROW
  LEVEL SECURITY`, two DB roles `app_migrator`/`app_tenant`) as layer one, a Prisma
  Client Extension (`apps/api/src/lib/prisma.ts`) as an independent layer two,
  `withTenantTx()` (`apps/api/src/lib/tenant-context.ts`) binding both per request via
  a Prisma interactive transaction so the session variable can never leak across a
  pooled connection. See `docs/adr/0001-multi-tenancy-rls.md`.
- Mandatory cross-tenant-leak test (`apps/api/test/tenant-isolation.test.ts`) proving
  each layer independently, plus a positive control proving the leak is real without
  both.
- JWT auth (`register`/`login`/`me`) + a minimal RBAC preHandler chain.
- `infra/docker-compose.yml`: postgres (pgvector image) + redis + one-shot `migrate` +
  `api`.

**Verified locally** (Postgres+Redis via plain `docker run`, migrations + RLS policies
applied by hand, API run via `tsx`, mirroring what `infra/docker-compose.yml` automates):
the full `npm test` suite (5/5, both defense layers proven independently + a positive
control), the register/login/me/admin-ping HTTP flow for two real tenants, and a forged
JWT (same secret, tenant B's `tenantId` + tenant A's `sub`) correctly getting rejected
rather than leaking tenant A's user record. Also bumped off Node 18 to Node 20 (and
`fastify`/`@fastify/jwt` off their vulnerable majors) after `npm audit` turned up
critical CVEs in `fast-jwt` — see engines field in `package.json`.

## Phase 1 — MVP: core ticketing + email/API ingestion + AI copilot v1

**Ticketing core backend ✅ (this pass).** Schema: `Team`, `Contact`, `TicketStatus`
(tenant-defined label + fixed `category` enum: `OPEN`/`PENDING`/`RESOLVED`/`CLOSED`),
`Ticket` (per-tenant sequential `number`, `TicketPriority` enum), `Message` (a public
reply and an agent-only internal note are both `Message` rows, differentiated only by
`isPrivateNote`), `ApiKey`. All wired into the same RLS + Prisma-extension isolation
as Phase 0 (`TENANT_SCOPE_FIELD` in `lib/prisma.ts`, loop-generated policies in
`prisma/rls/policies.sql`), plus a proportional isolation test
(`test/ticket-tenant-isolation.test.ts`). Fixed Admin/Agent/TeamLead RBAC (new
`tickets:read`/`tickets:write`/`tickets:manage_all` permissions;
`packages/shared/src/permissions.ts`). Default `TicketStatus` rows + a "General"
`Team` seeded at tenant registration (`modules/tickets/service.ts`'s
`seedDefaultTicketStatuses`, `modules/teams/service.ts`'s `seedDefaultTeam`).

The API channel: `POST /v1/tickets`, authenticated by `ApiKey` via
`plugins/apiKeyAuth.ts` — resolving "which tenant does this key belong to" from its
SHA-256 hash uses the same `SECURITY DEFINER` pattern as `resolve_tenant_id(slug)`
(`resolve_tenant_id_by_api_key_hash` in `prisma/rls/policies.sql`), since that lookup
has no tenant context yet either. Keys are issued via `POST /api-keys`
(admin/`users:manage`) and shown once, only the hash is stored. Also shipped:
`GET /ticket-statuses`, `GET /teams`, `GET /tickets` (+ `statusCategory` filter),
`GET /tickets/:id`, `POST /tickets/:id/messages`, `PATCH /tickets/:id` (status
changes into the `RESOLVED`/`CLOSED` categories auto-stamp `resolvedAt`/`closedAt` —
category drives behavior, never the tenant-chosen label, matching the ADR's
reasoning for why `TicketStatusCategory` exists at all).

Verified end to end locally: full register → issue API key → create ticket via API
key → list/get/reply/internal-note/patch → status-category-driven
`resolvedAt`/`closedAt` stamping, plus 401/403/404 edge cases, against a real
Postgres. `npm test` is 7/7 (5 Phase 0 + 2 new ticket-isolation tests).

**Agent console ✅ (this pass).** `apps/web`: React + Vite + TS + Tailwind +
react-router-dom. `AuthContext` (`src/auth/AuthContext.tsx`) holds the JWT in
`localStorage` and decodes it client-side purely to drive UI (which nav items show,
role labels) — the API re-checks authorization on every request regardless, the
decoded payload is never trusted for anything security-relevant. Pages: `/register`,
`/login`, `/tickets` (queue with status-category tabs), `/tickets/:id` (message
thread, reply/internal-note composer, status/priority/team/assignee editors backed
by `PATCH /tickets/:id`), `/api-keys` (issue + list, key shown once). Added two small
backend endpoints this needed: `GET /users` (tenant-scoped, gated on `tickets:read`
since any agent needs it for the assignee picker, not just admins) and
`@fastify/cors` (`CORS_ORIGIN` env var) so the web origin can call the API in dev.

Verified with a real headless-Chromium run (Playwright, downloaded ad hoc — no
project skill or `chromium-cli` was available in this environment; recommend
`/run-skill-generator` if this recurs) driving the full flow: register → land on
empty `/tickets` → create an API key through the UI → use it to `POST /v1/tickets`
exactly as an external integration would → confirm the ticket appears in the queue
→ open it → send a public reply → add an internal note (visually distinct, amber) →
change status via the dropdown → zero browser console errors throughout. Screenshots
taken at each step but not committed (they're a point-in-time verification artifact,
not living documentation). One real bug this caught **in the test, not the app**:
an initial version of the driver script used a page-wide Playwright `text=` selector
to detect "message sent," which also matches a `<textarea>`'s uncommitted value —
false-positived on the reply composer's own draft text before it was cleared. Fixed
by scoping assertions to the message list (`data-testid="message-list"` in
`TicketDetail.tsx`) instead of the whole page.

Also added `infra/docker/Dockerfile.web` (nginx serving the Vite build, SPA
fallback routing) and the `web` compose service — `VITE_API_URL` is a Vite build-time
constant, not read at container runtime, so a self-hosted operator changing the
API's public URL needs `docker compose build web` again, not just a restart. This is
a real limitation worth revisiting if it proves annoying in practice (options:
inject the URL from index.html at container startup instead of at build time; not
done here since it wasn't yet a real user complaint).

**Deferred from this pass, still open for Phase 1:**
- Email channel (IMAP/SMTP, threading) — needs real mail credentials to build against
  meaningfully; the `ChannelAdapter` interface it'll implement isn't written yet
  either, only the API channel exists concretely so far.
- Realtime updates over WebSockets via Redis pub/sub (the web app currently polls by
  navigation/refetch-after-mutation only — no live push).
- AI copilot v1 (reply suggestions, summarization, auto-classify).
- Knowledge base CRUD + full-text search.
- An endpoint to create additional users under a tenant (`registerTenant` only ever
  creates the first admin) — needed before "Fixed Admin/Agent/TeamLead RBAC" is
  actually exercisable by more than one person per tenant.
- `SEREDINA_MODE=self_hosted` auto-bootstrapping a default tenant in the `migrate`
  container.
- `infra/docker-compose.yml` has not been run as a single `docker compose up` in this
  environment (no compose plugin here) — verified by running each of its steps by
  hand instead (`docker run` for postgres/redis, manual migrate+RLS+seed, `tsx` for
  api). Worth an actual `docker compose up` smoke test in an environment that has the
  plugin before calling Phase 1 done.

## Phase 2 — Configurability + SLA

- `CustomFieldDefinition` + hybrid values (jsonb for the common case, a narrow typed
  mirror table only for fields explicitly marked filterable — not full EAV) +
  `TicketForm`.
- Tenant-defined `TicketStatus` labels mapped to the fixed `category` enum.
- `Macro` with a typed action union (not arbitrary code).
- `SlaPolicy` + `BusinessHours` + breach escalations.
- Outbound `Webhook`s (doubles as groundwork for Phase 3's "open framework").
- Reporting v1: volume, first-response/resolution time, SLA compliance, agent
  workload.

## Phase 3 — AI depth: RAG + MCP + autonomous mode

- pgvector `KbChunk` embeddings + a `search_knowledge_base` RAG tool.
- One shared tool catalog (`get_ticket`, `add_ticket_reply`, `set_ticket_status`,
  `assign_ticket`, `apply_macro`, `escalate_to_human`, ...) used by copilot,
  autonomous mode, and the MCP server alike — never a second implementation.
- `AutonomyPolicy` engine: per-tenant allow-list of tools that may auto-execute vs.
  require human approval, action caps, token/cost caps. Default = everything requires
  approval. Full `AiAgentRun` audit trail.
- `apps/mcp-server`: stdio + HTTP/SSE, per-tenant `ApiKey` auth resolved once into an
  `AsyncLocalStorage` session context — `tenantId` is never a tool input argument, so
  a connected external agent cannot escape its own tenant scope.
- Second LLM provider adapter (OpenAI) to validate the adapter abstraction actually
  is provider-agnostic.

## Phase 4 — Multi-tenant cloud hardening + more channels

- Tenant self-signup / plan-tier scaffolding.
- Per-tenant bring-your-own AI key UI.
- Widget (embeddable web chat) + WhatsApp/Telegram channels.
- Custom roles beyond the fixed three.
- Advanced reporting/CSAT/export.
- Automated RLS fuzz tests in CI.
- Verified stateless multi-replica `api`/`worker` + WS fanout under load.

## Backlog (explicitly deferred, not forgotten)

Third-party plugin marketplace for channels, mobile apps, voice/telephony,
BPMN-style workflow automation, SSO/SAML, per-tenant data residency, console i18n.

## Key risks (carried forward from planning, revisit each phase)

- RLS+Prisma pooling correctness is the single biggest technical risk in this whole
  system — mitigated in Phase 0, but any new tenant-scoped model added in later
  phases must get both an RLS policy AND a `TENANT_SCOPE_FIELD` entry, or it silently
  runs unscoped.
- Never call slow external I/O (LLM completions, SMTP sends) inside `withTenantTx` —
  it holds a pooled connection open for the duration and will starve the pool.
- AGPLv3: audit new dependencies for license compatibility; decide a contributor/CLA
  policy before accepting outside PRs.
- Autonomous AI mode is trust-sensitive — ship it opt-in, capped, and audited, never
  default-on.
