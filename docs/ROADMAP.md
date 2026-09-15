# Seredina Roadmap

Open source, fully configurable, multi-tenant helpdesk with pluggable AI agent
integration (copilot, autonomous, and an open MCP framework for external agents).
Self-hosted via Docker (single tenant) and cloud (multi-tenant) from one codebase.
AGPL-3.0-only.

## Vision expansion: ITSM/ITAM (GLPI-scope) + NOC/SOC — scoped explicitly, not guessed

The user asked for full GLPI feature parity (Service Desk, Asset Management, CMDB,
Data Center Management, Environmental Impact, Dynamic/agentless Inventory,
Governance, Antivirus Management, Application Deployment, Monitoring, Security
Alerts Management, MDM/MAM) plus NOC and SOC capability. Before building anything
against that, three scoping decisions were made explicitly with the user (not
inferred) because guessing wrong here would have wasted enormous effort:

1. **NOC/SOC = integrate, don't build.** Real network monitoring and security event
   correlation are each mature, decades-old product categories on their own
   (Zabbix/Nagios; Wazuh/a SIEM) — natively building either would be more work than
   this entire project combined several times over. Seredina's job is to become the
   ticketing/incident hub those tools feed into (via webhook ingestion, not yet
   built — see Phase 2.5 below), not to replace them.
2. **Agentless dynamic inventory was prioritized first** among the GLPI list (over
   Asset Management/CMDB itself, which is the more typically-natural starting point)
   — so CMDB was built alongside it, as the minimum destination the scanner needs to
   write into, not as a separate up-front phase.
3. **This is being driven by wanting the product to reach GLPI-level competitiveness,
   not by an internal need at the user's own company** — so prioritize breadth/
   correctness of the open-source feature set over anything specific to one
   deployment's IT operations.

See `docs/adr/0002-agentless-discovery.md` for the concrete engineering consequences
of decision 2 (why it's TCP+SNMP based, why it's capped at 1024 addresses, why it's
explicitly a "best-effort seed" and not a fingerprinting engine).

## Phase 0 — Foundations ✅ (this pass)

- Monorepo scaffold (npm workspaces): `apps/api`, `apps/web` (placeholder), `apps/worker`
  (placeholder), `apps/mcp-server` (placeholder), `packages/shared`, `packages/config`.
- PostgreSQL + Prisma; `Tenant`/`User`/`Role`/`Permission`/`RolePermission` schema.
- Multi-tenancy mechanism proven end to end: `tenant_id` + Postgres RLS (`FORCE ROW
  LEVEL SECURITY`, two DB roles `app_migrator`/`app_tenant`) as layer one, a Prisma
  Client Extension (`packages/db/src/prisma.ts`) as an independent layer two,
  `withTenantTx()` (`packages/db/src/tenant-context.ts`) binding both per request via
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
as Phase 0 (`TENANT_SCOPE_FIELD` in `packages/db/src/prisma.ts`, loop-generated
policies in `packages/db/prisma/rls/policies.sql`), plus a proportional isolation test
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

**`packages/db` extraction ✅ (this pass).** `apps/worker` needed the exact same
tenant-isolation guarantees as `apps/api` (to run discovery jobs safely per-tenant),
so the Prisma schema, migrations, `prisma/rls/policies.sql`, and the guarded-client/
`withTenantTx` mechanism itself moved out of `apps/api` into a new shared package,
`@seredina/db`, rather than being duplicated — duplicating the single most
security-critical mechanism in the codebase across two apps would have created
exactly the kind of silent-drift risk `docs/adr/0001-multi-tenancy-rls.md` warns
about. `apps/api` and `apps/worker` both now depend on `@seredina/db`; nothing about
the RLS/extension mechanism itself changed, only where it lives. Re-verified with
the full test suite (still 9/9 including the two suites added below) against a fresh
Postgres after the move, specifically to confirm the refactor didn't silently break
isolation.

**CMDB + agentless discovery ✅ (this pass).** New schema: `Asset` (best-effort
fields — type/status/IP/MAC/hostname/serial/manufacturer/model/OS/SNMP `sysDescr`,
upserted by `(tenantId, ipAddress)`), `TicketAsset` (bare id-pair CMDB linkage —
"this ticket is about that asset"), `DiscoveryJob` (one row per scan, an audit trail
kept after completion, not just a transient queue artifact). Two new permissions,
`assets:read`/`assets:manage` (`packages/shared/src/permissions.ts`).

`apps/worker` is now a real BullMQ consumer (was a placeholder through Phase 0/1):
`POST /discovery-jobs` (`assets:manage`) validates the CIDR
(`packages/shared/src/cidr.ts`, hard-capped at 1024 addresses / a `/22`) and enqueues
a job; the worker (`apps/worker/src/discovery/processor.ts`) enumerates every
address, probes each with bounded concurrency (32 at once —
`apps/worker/src/lib/concurrency.ts`) via a TCP-connect liveness heuristic
(`tcpProbe.ts`, ports 22/80/443/445/3389/8080, `ECONNREFUSED` counts as alive) run in
parallel with an SNMP `sysDescr`/`sysName` query (`snmpProbe.ts`, `net-snmp`,
community `public`), classifies the result heuristically (`classify.ts`), and
upserts an `Asset` per host that answered either probe. Queue name and job payload
shape are shared (`packages/shared/src/discovery.ts`) so the producer (`apps/api`'s
`lib/queue.ts`) and consumer can't drift on the contract.

Ticket detail (web) gained a "Linked assets" panel (link/unlink via
`POST`/`DELETE /tickets/:id/assets`), and a new `/assets` page: trigger a scan, see
scan history with live status (polls every 2s while a job is `PENDING`/`RUNNING`),
browse discovered assets.

Verified end to end against a **real positive detection**, not just "didn't crash":
started a throwaway HTTP listener on port 8080, ran a discovery job against
`127.0.0.1/32` through the actual API→queue→worker pipeline, confirmed the job
transitioned `PENDING → RUNNING → COMPLETED` with `discoveredCount: 1` and a real
`Asset` row, then linked/unlinked it to a ticket through the web UI (screenshot-
verified, zero console errors) and through raw HTTP (an unreachable range completing
with `discoveredCount: 0` rather than erroring; an oversized CIDR rejected with 400).
Added `test/asset-tenant-isolation.test.ts` (proportional to the existing pattern —
normal isolation + a forged cross-tenant write rejected by RLS) and
`infra/docker/Dockerfile.worker` + the `worker` compose service (`network_mode:
host`, Linux-only, so the worker can reach whatever LAN an operator scans — see the
ADR for why this is a real, not hypothetical, deployment constraint, and why its
`DATABASE_URL`/`REDIS_URL` had to change to `localhost:<host-mapped-port>` instead of
the compose service-name DNS that host networking bypasses).

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
- MAC-address-based asset identity instead of (or alongside) IP-based upsert, to
  survive DHCP lease churn on re-scans — a known limitation, see the ADR.

**Manual Asset CRUD ✅ (this pass).** `POST/PATCH/DELETE /assets` (`assets:manage`),
zod-validated (`z.string().ip()` for `ipAddress`; nullable fields use `.nullish()` so
PATCH can distinguish "don't touch this field" (`undefined`) from "clear it"
(`null`) — plain `.optional()` can't express the second case). Hand-entered assets
keep `discoverySource: MANUAL`, same table/RLS as scanner-discovered ones. Web:
a reusable `Modal` (now `role="dialog"`/`aria-modal` for both real accessibility
and reliable test targeting) + `AssetFormModal` shared between create and edit, a
"New asset" button, and per-row edit/delete on `/assets`.

Browser-verified end to end (fresh tenant per run, to avoid the same stale-DOM-match
trap noted in Phase 1's frontend section) — create, edit, zod rejecting a malformed
IP, delete, all through the actual UI. **This caught a real, previously-shipped bug**:
`apiDelete` (`apps/web/src/lib/api.ts`) unconditionally set `Content-Type:
application/json` even with no request body; Fastify's JSON body parser runs for any
method that can carry a body (DELETE included) and rejects an empty one when the
header claims JSON (`FST_ERR_CTP_EMPTY_JSON_BODY`). This silently broke **both**
"delete asset" and the ticket detail "remove" (unlink asset) button from the moment
they shipped — Phase 1's browser verification tested *linking* an asset but never
*unlinking* one, so it went uncaught until this pass exercised it. Fixed generically
in `apiFetch` (only set `Content-Type` when `options.body !== undefined`), which
fixes both call sites from one change. Re-verified specifically: unlink now returns
200 and the ticket refetches correctly (confirmed via server log, since the UI
assertion itself needed care — the just-unlinked asset's name still appears as a
now-available `<option>` in the "link another asset" dropdown, which a careless
text-match assertion mistakes for "still linked").

## Phase 2 — Configurability, SLA, and ITSM/ITAM breadth (GLPI parity)

The GLPI feature list the user asked to match, mapped to concrete near-term work.
Nothing here is built yet — CMDB/discovery (Phase 1, above) was deliberately
sequenced first as the foundation the rest reads/writes against.

- **Service Desk**: already the ticketing core (Phase 1). GLPI parity here mostly
  means the configurability items below (forms, SLA, macros), not new ticket
  concepts.
- **Configuration Management (CMDB)**: `CustomFieldDefinition` + hybrid values
  (jsonb for the common case, a narrow typed mirror table only for fields explicitly
  marked filterable — not full EAV) + `TicketForm`, extended to `Asset` too (custom
  fields per asset type). Tenant-defined `TicketStatus` labels already ship (Phase
  1); this generalizes the same pattern.
- **Security Alerts Management** (the SOC integration point): generic inbound
  webhook endpoint that turns an external tool's alert (Wazuh, a SIEM, whatever) into
  a `Ticket` (or a new lighter-weight `Incident` type, undecided) — this is what "SOC
  integrated" concretely means per the scoping decision above. Natural home for
  Phase 2's `Webhook` model to start as inbound, not just outbound.
- **Monitoring** (the NOC integration point): same shape as Security Alerts — ingest
  uptime/performance alerts from Zabbix/Nagios/Grafana via webhook rather than
  polling infrastructure ourselves. Could share the same generic inbound-webhook
  endpoint as Security Alerts, differentiated by payload/source, not a separate
  system.
- `Macro` with a typed action union (not arbitrary code).
- `SlaPolicy` + `BusinessHours` + breach escalations.
- Outbound `Webhook`s (doubles as groundwork for Phase 3's "open framework").
- Reporting v1: volume, first-response/resolution time, SLA compliance, agent
  workload, plus asset counts/types once Asset Management has enough data to report
  on.

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

**Remaining GLPI-list items with no phase yet** — not dropped, just not close enough
to be worth a concrete plan until the items above land and it's clearer which of
these real users actually want:
- **Data Center Management**: racks/servers/physical location tracking — a
  specialization of Asset Management (Phase 2) once that exists, not a separate
  subsystem.
- **Environmental Impact Management**: GLPI's sustainability/carbon-footprint
  tracking for IT assets — needs real power/lifecycle data models nothing here has
  yet.
- **Governance Helping**: GLPI's term is broad (compliance/governance workflows);
  needs the user to clarify what concretely this should mean here before it's
  plannable.
- **Antivirus Management**: tracking AV deployment/status per endpoint — needs an
  actual agent or an AV vendor's API integration, neither of which exists yet.
- **Application Deployment**: pushing software to endpoints — needs an agent (this
  is fundamentally different from the agentless discovery built in Phase 1, which
  only ever reads).
- **Mobile Device/Application Management (MDM/MAM)**: enrollment, remote
  wipe/policy push — its own significant subsystem (comparable in scope to e.g.
  Microsoft Intune), effectively a separate product; revisit only if there's real
  demand, not preemptively.

**Other**: third-party plugin marketplace for channels, mobile apps, voice/telephony,
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
- Agentless discovery is architecturally meaningless in shared multi-tenant cloud
  mode (no access to a customer's private LAN) — currently it just silently finds
  nothing there rather than being disabled/warned against; needs a real guard before
  cloud GA. See `docs/adr/0002-agentless-discovery.md`.
