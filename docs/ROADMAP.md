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
   ticketing/incident hub those tools feed into (via webhook ingestion — `POST
   /v1/alerts`, shipped in Phase 2, see below), not to replace them.
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

**Email channel ✅ (this pass).** `EmailChannel` model (per-tenant IMAP+SMTP config,
passwords AES-256-GCM encrypted via `ENCRYPTION_KEY` — the one place in the schema
needing a genuinely recoverable secret, not hashed). `apps/worker` gained a plain
interval poll loop (not a BullMQ repeatable job — see
`docs/adr/0004-email-channel.md` for why) that discovers every tenant's active
channels via a new `list_active_email_channels()` `SECURITY DEFINER` function (same
pattern as `resolve_tenant_id`/`resolve_tenant_id_by_api_key_hash`), fetches new mail
via `imapflow`, parses via `mailparser`, and threads replies by matching In-Reply-To/
References against a new `Message.externalId` column. Outbound replies enqueue onto
a new `email-send` BullMQ queue (from `modules/tickets/service.ts`'s `addMessage`,
only for `channel: 'email'` tickets) and go out via `nodemailer`.

A reply to a **closed** ticket's thread reopens it — deliberately different from
alert ingestion's dedup (`docs/adr/0003-alert-ingestion.md`), where a closed ticket
gets a fresh one; a reply really is the same conversation continuing, an alert
re-firing really is a new occurrence, and the ADR explains why those aren't the same
shape.

**Verified against a real mail server, not mocked** (`greenmail/standalone` Docker
image, both SMTP and IMAP): sent mail as an external customer → worker's poll loop
created the ticket → replied through the real API → confirmed the reply was
automatically sent (no manual trigger) via the real BullMQ worker → connected via
IMAP as the customer and confirmed correct `In-Reply-To`/`References` threading
headers → replied again threaded to that email and confirmed it landed on the same
ticket, not a new one → closed the ticket → replied once more and confirmed it
reopened automatically. This real-server testing caught a genuine bug no mock would
likely have: issuing a `STORE` (mark-as-seen) command while a multi-message `FETCH`
was still streaming on the same IMAP connection hung indefinitely against Greenmail
— fixed by batching all flag updates after the fetch loop fully drains. Full
narrative in the ADR. Browser-verified the `/email-channels` settings page and the
rendered conversation thread, zero console errors.

**Deferred from this pass, still open for Phase 1:**
- A ticket doesn't remember which specific `EmailChannel` it arrived through —
  outbound send just picks the tenant's first active one. Fine for one channel per
  tenant (the expected case); needs `Ticket.emailChannelId` before multiple email
  channels per tenant are meaningfully supported.
- No email attachment handling (`mailparser` extracts them; nothing stores/surfaces
  them yet).
- Realtime updates over WebSockets via Redis pub/sub (the web app currently polls by
  navigation/refetch-after-mutation only — no live push).
- AI copilot v1 (reply suggestions, summarization, auto-classify).
- Knowledge base CRUD + full-text search.
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

**Multi-user tenants ✅ (this pass).** `registerTenant` only ever created the first
admin — until this pass there was no way to actually exercise the Admin/Agent/
TeamLead RBAC with more than one person, so `agent`/`team_lead` were completely
inert in practice. `POST /users` (`users:manage`) creates additional users with a
role by key; `PATCH /users/:id` changes name/role; `GET /roles` lists the tenant's
fixed three roles for pickers. No invite/email flow yet (no email sending exists) —
an admin sets the initial password directly and shares it out of band, same
trade-off `registerTenant` already made. Web: a `/users` page (nav item gated on
`hasPermission('users:manage')` — the first real use of that helper beyond auth
guarding) with a "New user" modal and an inline per-row role `<select>`.

Verified with what this feature actually exists to prove — a **non-admin
permission boundary**, for the first time in this project (every prior test used
the single admin account `registerTenant` creates): registered a tenant, created an
`agent` user through the API, logged in as them, decoded their JWT to confirm
`permissions: ['tickets:read', 'tickets:write', 'assets:read']` (no `users:manage`,
no `assets:manage`), confirmed they can `GET /tickets` (200) but are correctly
rejected from `POST /users` (403) and `POST /discovery-jobs` (403), then promoted
them to `team_lead` via `PATCH /users/:id` and confirmed the role stuck. Browser-
verified the `/users` page end to end (create, inline role change), zero console
errors.

## Phase 2 — Configurability, SLA, and ITSM/ITAM breadth (GLPI parity)

The GLPI feature list the user asked to match, mapped to concrete work. CMDB/
discovery (Phase 1) was deliberately sequenced first as the foundation the rest
reads/writes against.

- **Service Desk**: already the ticketing core (Phase 1). GLPI parity here mostly
  means the configurability items below (forms, SLA, macros), not new ticket
  concepts.

**Security Alerts Management + Monitoring (the SOC/NOC integration points) ✅ (this
pass).** `POST /v1/alerts` — same `ApiKey` auth as `POST /v1/tickets` (one
credential type, not two) — turns an external tool's alert into a `Ticket`
(`channel: 'alert'`). Deliberately reuses `Ticket` rather than a new `Incident`
model, resolving what `docs/adr/0002-agentless-discovery.md` had left explicitly
undecided — see `docs/adr/0003-alert-ingestion.md` for the full reasoning (the
lifecycle and every mechanism that already exists for it — RBAC, status categories,
assignment — is identical; a separate model earns its cost only when the lifecycle
actually diverges, and it doesn't here). One generic endpoint covers both Security
Alerts and Monitoring — they're the same shape (external tool → ticket), just
differentiated by `source`/payload, not separate systems, exactly as flagged when
this was still just a roadmap note.

Concretely: a normalized 5-value `severity` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`INFO`)
maps to `TicketPriority` — mapping a specific tool's native scheme (Zabbix's
"Disaster".."Not classified", Wazuh's numeric rule levels, ...) into this is the
integrator's job, kept out of Seredina to stay tool-agnostic. A new nullable
`Ticket.externalId` column (the source tool's own alert/event id) drives
deduplication: a re-fired alert for a problem whose ticket is still open (status
category ≠ `CLOSED`) folds into that ticket as a new message instead of spawning a
duplicate — without this, an alert storm (a flapping service re-notifying every few
minutes) would be unusable. A `CLOSED` ticket with the same `externalId`
legitimately gets a fresh ticket (a new occurrence, not a reopening) — this is a
service-layer lookup (`ingestAlert` in `modules/tickets/service.ts`), not a DB
constraint, since "duplicate" depends on the existing ticket's current status. Alerts
get a synthetic per-source `Contact` (`{source}@alerts.local`) since `Ticket`
requires one and inventing a nullable-contact code path everywhere wasn't worth it
for this one case.

Web: a `Channel` column/badge on the ticket queue and detail header
(red for `alert`, distinguishing it from `api`), plus the `externalId` shown as
`ref: <id>` when present.

Verified end to end against a real Postgres, not just unit-level: registered a
tenant, issued an API key, POSTed a `CRITICAL` alert (→ `URGENT` priority), re-POSTed
the identical `externalId` (confirmed it folded into the same ticket as a second
message, no new ticket number), closed that ticket, POSTed the same `externalId`
again (confirmed a genuinely new ticket, not a reopen), and confirmed the synthetic
contact was reused correctly across both of a source's tickets. Browser-verified the
channel badges and `ref:` display render correctly with zero console errors.

- **Configuration Management (CMDB)**: `CustomFieldDefinition` + hybrid values
  (jsonb for the common case, a narrow typed mirror table only for fields explicitly
  marked filterable — not full EAV) + `TicketForm`, extended to `Asset` too (custom
  fields per asset type). Tenant-defined `TicketStatus` labels already ship (Phase
  1); this generalizes the same pattern.
- `Macro` with a typed action union (not arbitrary code).
- `SlaPolicy` + `BusinessHours` + breach escalations.
- Outbound `Webhook`s (doubles as groundwork for Phase 3's "open framework") — note
  this is the *opposite* direction from `POST /v1/alerts` above (Seredina notifying
  something else vs. something else notifying Seredina); both will likely end up
  called "Webhook" in the UI eventually, worth a naming pass when both exist to avoid
  confusing the two directions.
- Reporting v1: volume, first-response/resolution time, SLA compliance, agent
  workload, plus asset counts/types once Asset Management has enough data to report
  on, plus alert-channel volume (how many tickets came from monitoring vs. real
  requesters) now that there's a `channel` to group by.

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
- `ENCRYPTION_KEY` loss or rotation makes every stored `EmailChannel` password
  undecryptable — same operational weight as losing `JWT_SECRET`, but easier to
  overlook since it's a newer env var; back it up like a database password, document
  this prominently before any real self-hosted deployment. See
  `docs/adr/0004-email-channel.md`.
- Multiple `worker` replicas would double-poll every tenant's email channels (the
  interval-loop design isn't coordinated across instances) — a real constraint on
  horizontal scaling, not yet solved, deferred to Phase 4 alongside the equivalent
  discovery-worker scaling question.
