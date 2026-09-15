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

- Ticketing schema: `Ticket`, `Message`, `TicketStatus` (+ fixed `category` enum),
  `Priority`, `Team`, `Contact`, `Tag`, `Attachment`.
- Fixed Admin/Agent/TeamLead RBAC.
- Channels: email (IMAP poll or inbound webhook + SMTP out, threaded via
  `In-Reply-To`/`References`) and API (`POST /v1/tickets` via `ApiKey`) behind one
  `ChannelAdapter` interface.
- Web app: queue view, ticket detail, reply/internal-note composer, team/user admin.
- Realtime ticket updates over WebSockets via Redis pub/sub.
- AI copilot v1 (Anthropic only): reply suggestions, summarization, auto-classify —
  human always approves/sends. No tool-calling loop yet, just single-completion
  enrichment jobs.
- Knowledge base CRUD + full-text search (no embeddings yet).
- Self-hosted Docker Compose fully working end to end, including
  `SEREDINA_MODE=self_hosted` auto-bootstrapping a default tenant.

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
