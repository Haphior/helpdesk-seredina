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
- ~~AI copilot v1 (reply suggestions, summarization, auto-classify)~~ — reply
  suggestions and summarization shipped (below); auto-classify still open.
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

**UI visual refresh ✅ (this pass).** The agent console worked but looked like an
unstyled admin panel (default system font, flat white cards, native `<select>`s,
minimal color). Explored the direction first as a mockup (a Claude Design canvas
with the four highest-traffic screens — tickets list, ticket detail, sign in,
register) before touching real code, so the visual direction was approved once
rather than iterated on inside the app. Direction: Linear/Height-style refined
minimal — `Plus Jakarta Sans` (Google Font, loaded in `apps/web/index.html`,
`fontFamily.sans` in `tailwind.config.js`) on the existing slate-neutral base, a
single indigo→violet accent, and a clearer semantic palette for status (`OPEN`=sky,
`PENDING`=amber, `RESOLVED`=emerald, `CLOSED`=slate) and priority (`LOW`=slate,
`NORMAL`=indigo, `HIGH`=orange, `URGENT`=rose) — `Badge` (`components/Badge.tsx`)
gained an optional leading dot for this. New shared primitives: `components/
icons.tsx` (inline stroke SVG, no icon library dependency) and `components/
Avatar.tsx` (deterministic initials + color from a name hash, used for
agents/contacts throughout). `Layout.tsx`'s sidebar now shows the tenant name and a
real user identity in its footer — pulled from `GET /auth/me`, which the API
extended to include `tenantName` (`modules/auth/service.ts`) since the UI had no
prior way to know the workspace's display name. `TicketsQueue`/`TicketDetail` moved
from an HTML `<table>`/stacked-label form to row/property-row layouts closer to a
Linear issue view; `Login`/`Register` share a new `AuthLayout` (gradient brand panel
+ centered form) instead of a bare centered card. No functional/permission changes —
same endpoints, same RBAC, same data shapes.

Verified against the real running app, not just visually: logged in as a real
tenant, created a ticket via the API channel exactly as before, changed its status
through the redesigned `<select>`, and sent a reply through the redesigned composer
— confirmed each mutation actually round-tripped (not just that it looked right),
zero browser console errors throughout.

**Security hardening pass ✅ (this pass).** Prompted by an external checklist audit
(40 generic items across two lists) — most were already covered by existing
architecture (RLS, parameterized queries via Prisma, bcrypt, server-side auth on
every route, no cookies so CSRF doesn't apply) or don't apply yet (no payments, no
file uploads, no shipped AI feature). Four real gaps fixed:

- **Account lockout**: 5 failed logins locks the account 15 minutes
  (`User.failedLoginAttempts`/`lockedUntil`). Caught a real bug while verifying
  against a real Postgres — the counter update was originally inside the same
  Prisma transaction as the throw signaling failed login, so the write was
  silently rolled back with everything else. Fixed by returning `null` from the
  transaction and throwing only after it commits.
- **Rate limiting** (`@fastify/rate-limit`): 300/min global, 10/min on
  `/auth/login`, 5/min on `/auth/register` — independent of account lockout (this
  is per-IP and resets every window; lockout is per-account and doesn't).
- **Security headers** (`@fastify/helmet` on the API; baseline headers on the
  nginx-served web app) — HSTS, CSP, X-Frame-Options, X-Content-Type-Options.
- **CORS fails closed in production**: `CORS_ORIGIN` is now required when
  `NODE_ENV=production` (already set by the Docker runtime images) instead of
  silently defaulting to allow-all; local dev keeps the existing permissive
  default.

Also: explicit `bodyLimit` instead of Fastify's implicit default. Verified against
the real running API: hammered `/auth/login` past its limit and got real 429s,
confirmed helmet headers on a live response, confirmed the CORS guard both fails
closed with no `CORS_ORIGIN` and boots correctly with one set, full existing test
suite (9/9) still green. Remaining lower-priority items from the audit (CAPTCHA/bot
protection on login+register, CI-gated dependency scanning, a real security-event
audit log, tenant-slug enumeration on `/auth/register`) are deliberately deferred,
not silently dropped — revisit once real users exist.

**AI copilot v1 ✅ (this pass).** `packages/ai-adapters`: a provider-agnostic
`LlmProviderAdapter` interface (`complete()`), `AnthropicAdapter` (real, using
`@anthropic-ai/sdk`, model configurable via `ANTHROPIC_MODEL`, defaults to
`claude-opus-5`), and a `TestProviderAdapter` double for tests — no route/service
code depends on the Anthropic SDK directly. Two actions on a ticket, both
copilot-only (suggest, human approves — never auto-sent, never auto-applied):
`POST /tickets/:id/ai/suggest-reply` and `POST /tickets/:id/ai/summarize`, gated
on `tickets:write`. Internal notes are unconditionally excluded from what the
model sees (`modules/ai/service.ts`'s `loadTicketThread`) — a private note can
contain things an agent never meant to end up in a customer-facing draft. See
`docs/adr/0005-ai-copilot.md` for the full reasoning, including why extended
thinking is explicitly disabled (this is a real-time UI action, not open-ended
reasoning) and why copilot-only was a deliberate choice, not a v1 shortcut.

`getAiAdapter()` returns `null` when `ANTHROPIC_API_KEY` is unset, same
graceful-absence pattern as error tracking and email channels — routes turn that
into a `503`, the web UI (`TicketDetail.tsx`'s new "Summarize"/"Suggest reply"
buttons, sparkle icon) shows it inline without breaking the rest of the ticket
page.

**Verified**: 3 new automated tests against a real Postgres (no network —
`TestProviderAdapter`) prove prompt construction and, specifically, that a
distinctive marker string placed in an internal note never reaches the prompt
sent to the provider, for both actions; plus a real `curl` against the running
API confirming the `503` path, and a real browser run confirming the UI renders
that error inline with zero console exceptions. **Not verified**: no Anthropic
API key was available this session, so `AnthropicAdapter`'s actual request to
the live Anthropic API has never been exercised — written correctly against the
current SDK's types, not from training-data memory, but that's a different claim
than "confirmed working." Documented plainly in the ADR rather than glossed
over, same transparency standard as every other honestly-flagged gap in this
project.

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

**Configuration Management: custom fields ✅ (this pass).** `CustomFieldDefinition`
(tenant-scoped, 5 types: TEXT/NUMBER/BOOLEAN/DATE/SELECT) + a single
`Ticket.customFields Json?` column — jsonb only, no typed mirror table yet (see
`docs/adr/0006-custom-fields.md` for why that's a deliberate scope cut: nothing
needs to filter/report on a custom field's value until Reporting v1 exists, so
building the filtering-optimized half now would be speculative). `PATCH
/tickets/:id` merges into the existing `customFields`, never replaces it
wholesale — the kind of bug that looks fine with one field and breaks with two,
covered by an automated test specifically for that. Reading definitions is
`tickets:read` (every agent needs to see/fill them in); defining them is
`tickets:manage_all` (admin/team_lead, a tenant-wide configuration concern).
`TicketForm` (drag-and-drop field layout) and extending custom fields to `Asset`
are still open — this pass is fields + values only, not layout.

Verified: 3 new automated tests against a real Postgres (definition defaults,
clean duplicate-key error, and specifically the merge-not-replace behavior
across sequential patches), full suite 15/15 green. Browser-verified end to
end: created a TEXT/SELECT/required-BOOLEAN field as admin, confirmed all three
render on a real ticket's details panel, edited each one, confirmed the values
survive a full page reload — a real round trip, not a mocked assertion.

**Hardware/equipment catalog ✅ (this pass).** `Manufacturer` + `AssetModel`
reference tables, decoupled from `Asset` instances — many assets share one
model. `Asset.modelId` is an optional FK (`SET NULL` on delete, so cleaning up
the catalog never touches the asset itself); picking a model in the "New asset"
form prefills manufacturer/type fields instead of re-typing them per device,
which was most of what made manual inventory entry tedious. Tenant-curated (a
new "Equipment Catalog" settings page, `assets:manage`-gated, can create a
brand-new manufacturer inline while adding a model), not backed by an external
device-database API — no network dependency a self-hosted operator would
otherwise be stuck depending on. See `docs/adr/0007-equipment-catalog.md`.

Verified: 3 automated tests against a real Postgres (model creation defaults, a
clean duplicate-name error, and specifically that deleting a manufacturer
cascades to its models and `SET NULL`s any linked asset without touching the
asset itself), full suite 18/18 green. Browser-verified end to end: created a
manufacturer + model in one step, picked it from a real asset's form, confirmed
via a direct API read that the asset's `modelId`/`catalogModel` link and its
prefilled fields were all correct.

**IT processes / procedures ✅ (this pass) — resolves the "Governance Helping"
item below**, now that there's concrete direction instead of GLPI's broad label:
`ProcessTemplate`/`ProcessStepTemplate` (ordered steps, each optionally assigned
to a team, optionally requiring approval) spawns a `ProcessInstance`/
`ProcessStepInstance` tracking per-step completion/approval/assignee over
however long it actually takes — employee onboarding, a commercial document
approval chain. Deliberately **not** the same model as `Macro` (still unbuilt):
a Macro is a one-shot bundle of actions applied instantly to a single ticket;
a Process is a multi-step, multi-person checklist that outlives any single
conversation. `ProcessStepInstance.ticketId` exists for linking real IT work,
but the picker UI for it isn't built yet — backend capability shipped ahead of
the frontend for it, honestly, not silently dropped. See
`docs/adr/0008-it-processes.md`, including a real bug caught before it
shipped: Prisma's default `onDelete` behavior for a required relation would
have made deleting a template cascade-delete every instance ever started from
it — fixed to `SET NULL` plus a `templateName` snapshot before any service code
was written against it.

Verified: 5 automated tests against a real Postgres (step ordering, duplicate-
name/empty-steps rejection, the template-delete-preserves-instances fix, the
approval-guard rejecting a plain `DONE`, and the auto-complete/auto-reopen
symmetry), full suite 23/23 green. Browser-verified end to end: built a 3-step
template (one requiring approval), started an instance, drove it through all
three steps — confirming the approval step's dropdown never even offers `DONE`
as an option — and confirmed the instance auto-completed, zero console errors.

**Plugin/extension architecture (recommendation; the webhook piece is now real,
the rest isn't) — resolves the vague "third-party plugin marketplace" backlog
mention below.** Recommending a **contract-based** model over native in-process
code-loading: outbound `Webhook`s (✅ shipped, see below) for "notify an
external system," the existing scoped
`ApiKey` + REST API for "let an external system act on Seredina," and the planned
MCP server (Phase 3) as the structured interface for AI-era integrations (n8n,
a customer's own agent, Zapier-style tools). Deliberately **not** a GLPI/WordPress-
style loaded-code plugin system: Seredina runs the same process for every tenant
in cloud mode, and a plugin able to execute arbitrary code inside that process is
a direct route around the RLS + Prisma-extension tenant isolation this entire
project is built on — one tenant's "plugin" could read another tenant's data. A
contract-based model keeps every integration out-of-process in both deployment
modes, so it can't bypass isolation regardless of who wrote it. A self-hosted-only
native plugin loader (accepting that a self-hoster runs their own trusted code) is
a legitimate but *separate* future decision, not the default extensibility path —
flagging this as a recommendation to confirm, not a decision already made
unilaterally.

**Macros ✅ (this pass)** — `Macro` (name, a typed `actions` union as jsonb: optional
`setStatusId`/`setPriority`/`setTeamId`/`setAssigneeId`/`addReply`, validated to
require at least one action) applied instantly to a single ticket via a "Run
macro…" dropdown in the ticket header. Deliberately not arbitrary code — same
reasoning as the plugin/extension recommendation above, and see
`docs/adr/0010-macros.md`. `applyMacro` calls the existing `updateTicket`/
`addMessage` service functions rather than duplicating their logic, so a macro
automatically inherits webhook dispatch, timestamp stamping, and internal-note
handling for free. Same read/write permission split caught and fixed on custom
fields and process templates: listing/applying macros is `tickets:write` (any
agent working a ticket), defining/deleting one is `tickets:manage_all`
(tenant-wide configuration) — this exact mismatch was over-gated on the first
pass here too and fixed before shipping.

Verified: 4 automated tests (rejection of an empty action set, real
`updateTicket`/`addMessage` integration, not-found handling), full suite
31/31 green. Browser-verified end to end: created a macro setting priority to
URGENT and adding a canned reply, opened a ticket that was NOT yet urgent,
applied the macro via the dropdown, and confirmed both the priority badge
updated to URGENT and the canned reply appeared in the thread — zero console
errors.

**SLA engine ✅ (this pass)** — `SlaPolicy` (one row per tenant+priority: first-
response/resolution targets in minutes, optional business-hours-only gating) +
`BusinessHours` (one schedule per tenant: IANA timezone + a window per weekday).
Due dates (`Ticket.firstResponseDueAt`/`resolutionDueAt`) are computed at ticket
creation and recomputed whenever priority changes (from the moment of the
change, not the original creation — see `docs/adr/0011-sla-engine.md`), and are
null (no tracking) for any priority with no configured policy — opt-in by
construction. Breach detection is two-layered: a passive, always-accurate
"overdue" badge computed at render time (ticket queue clock icon, ticket-detail
header badges, a red due-date row in the details panel), and an active
`sla.first_response_breached`/`sla.resolution_breached` webhook fired by a
delayed BullMQ job that re-checks live ticket state before ever firing, so a
stale job is never wrong, only sometimes a harmless no-op.

Verified: 7 integration tests against real Postgres (no-policy → null due-ats,
matching-policy → correct calendar-time due-ats within tolerance of `Date.now()`,
a priority change recomputing from now while an unrelated patch leaves an
already-set due-at untouched, a business-hours-gated due-at genuinely landing
inside the configured window, `firstRespondedAt` stamped once and never by an
internal note) plus 6 pure-function tests for the business-hours date math
(same-day, before-window-opens, same-day gap between two windows, weekend
rollover, a fixed-offset timezone changing the local weekday). Full suite
29/29 green (skips are pre-existing, unrelated tenant-isolation opt-in tests),
both `apps/api` and `apps/worker` typecheck clean. Browser-verified end to end:
configured a Business Hours schedule and a LOW-priority SLA policy through the
UI, confirmed a real ticket created afterward picked up the right due-ats, and
(since waiting out a real SLA window isn't practical) backdated a real ticket's
due-ats in Postgres to confirm the overdue badges and clock icon render
correctly — zero console errors. Also surfaced and fixed an unrelated dev-
environment issue: several stale orphaned `tsx watch` processes had
accumulated across the session, and the generic (deliberately vague, to avoid
leaking which part of a login attempt failed) `/auth/login` error handling
was masking a `DATABASE_URL` mismatch on one restart as an ordinary wrong-
password error — see the ADR for how that was diagnosed.

**Outbound webhooks ✅ (this pass)** — the opposite direction from `POST
/v1/alerts` above (Seredina notifying something else vs. something else
notifying Seredina); the naming-pass concern flagged when this was still just
a roadmap note (both directions ending up called "Webhook" in the UI) turned
out fine in practice — `/webhooks` (outbound, tenant-configured) and
`/v1/alerts` (inbound, monitoring-tool-configured) are different enough pages
that confusing them hasn't been an issue. `Webhook` (url, HMAC secret
encrypted at rest, subscribed events) fires on `ticket.created`,
`ticket.updated`, `message.created` (internal notes excluded, same reasoning
as the AI copilot's prompt-building). https-only, with a best-effort SSRF
guard checked at both creation and delivery time — see
`docs/adr/0009-outbound-webhooks.md`, including a real mistake caught and
fixed before shipping: BullMQ's retry/backoff options were first placed on
the Worker constructor, which silently ignores them — they belong on the job
at enqueue time.

Verified: 4 automated tests (https-only rejection, secret-shown-once, and the
dispatch filtering logic) plus 4 pure-function tests for the SSRF range
checks, full suite 27/27 green. Beyond that, directly against real
infrastructure: confirmed the SSRF guard actually blocks a delivery to
`127.0.0.1`, confirmed a real delivery to a live public HTTPS endpoint
succeeds and is recorded, and confirmed the full pipeline end to end through
the real worker process — created a webhook via the browser, created a real
ticket via the API, and watched the webhook's delivery status update to
match, not a direct function call standing in for the real path.

- Reporting v1: volume, first-response/resolution time, SLA compliance, agent
  workload, plus asset counts/types once Asset Management has enough data to report
  on, plus alert-channel volume (how many tickets came from monitoring vs. real
  requesters) now that there's a `channel` to group by.

**Added 2026-09-16, from a competitive pass against Jira Service Management, GLPI,
and ManageEngine ServiceDesk Plus — see the research notes below each item.
Ordered here roughly by how directly each one builds on something already
shipped, not by external priority:**

- **Agent collision detection + ticket merge + bulk actions.** The three items
  that showed up as "must-have" in essentially every source checked, and the
  cheapest of everything in this addition — no new data model. Collision
  detection is "who else has this ticket open right now," a presence signal
  (WebSocket or short-poll) keyed by `ticketId`, not a new table. Merge folds
  one ticket's messages into another's and closes the source — mechanically
  close to what `ingestAlert`'s re-fire-folding already does for a different
  reason, so there's a real precedent to reuse rather than invent. Bulk actions
  (assign/close/tag several tickets from the queue) are UI + a loop over the
  existing single-ticket `updateTicket`, not new backend logic.
- **On-call scheduling + SLA escalation chains.** The direct sequel to this
  pass's SLA engine, not a separate concern — Opsgenie-inside-Jira-SM is the
  clearest competitive example of exactly this combination. Where the SLA
  engine's breach webhook (`sla.*_breached`) is the endpoint today, this adds
  what actually receives it: an on-call rotation (`OnCallSchedule` +
  `OnCallShift`, whoever's on shift right now) and an escalation chain ("if
  the on-call person hasn't acknowledged in N minutes, escalate to the next
  tier") that consumes the same breach-check delayed-job mechanism already
  built rather than a second scheduler.
- **Service Catalog.** A tenant-defined list of *requestable things*
  ("new laptop," "VPN access," "onboard a contractor"), each pointing at its
  own form — the missing piece `docs/adr/0006-custom-fields.md` already
  flagged as a known v1 limitation ("no drag-and-drop `TicketForm` layout
  customization... a separate, larger GLPI-parity item"). This is that item,
  now named concretely instead of deferred vaguely: `ServiceCatalogItem`
  (name, description, icon, which `CustomFieldDefinition`s it shows) creates a
  `Ticket` pre-filled from the chosen item, the same creation path every other
  channel already uses.
- **Change Management (ITIL).** Deliberately scoped as an extension of the
  existing IT Processes engine (`ProcessTemplate`/`ProcessInstance`, Phase 2 ✅),
  not a new subsystem: a `ProcessTemplate.kind = 'CHANGE'` (or a small
  dedicated fields addition — risk level, planned window, rollback plan) reuses
  every mechanism already proven there, including the approval-gated step type
  that already makes a CAB-style sign-off enforceable. Building a whole
  separate Change model when the process engine already does "multi-step,
  approval-gated, outlives-a-single-ticket" would be two systems pretending to
  be one — the same reasoning `docs/adr/0003-alert-ingestion.md` used to keep
  alerts on `Ticket` instead of a new `Incident` model.
- **Problem Management (ITIL).** Distinguishing a root cause ("Problem") from
  the individual incidents it's causing — Jira Service Management treats this
  as a first-class, separate concept from ticket/incident. Not yet designed in
  as much detail as the item above: likely a lightweight `Problem` record that
  several `Ticket`s can link to (many incidents, one root cause), surfaced as
  "N linked incidents" on the problem and "linked to Problem #X" on each
  ticket. Sequenced after Change Management above since a real problem
  management workflow usually *produces* a change request as its fix.
- **Self-service portal + a browsable knowledge base.** A real gap, not a
  duplicate of Phase 3's RAG plan below: this needs `KbArticle` as a plain,
  human-browsable CRUD resource (a contact can read and search it directly)
  *before* anything AI-related touches it. Phase 3's `pgvector` embeddings and
  `search_knowledge_base` tool should be an enhancement layered onto these same
  articles, not the reason they exist — a knowledge base that only an AI can
  query isn't a knowledge base a support team can maintain or trust. Worth
  pulling the plain-CRUD half of this forward into Phase 2 rather than waiting
  for Phase 3, given how consistently "the KB is incomplete/impossible to
  search live" showed up as a real agent pain point in the research pass.

## Phase 3 — AI depth: RAG + MCP + autonomous mode

- pgvector `KbChunk` embeddings + a `search_knowledge_base` RAG tool, layered
  onto the plain `KbArticle` CRUD resource added in Phase 2 above — the
  articles need to exist and be human-maintained first; this phase makes them
  AI-searchable, not the other way around.
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

## Phase 5 — Endpoint agents (Windows/Linux/macOS)

Not yet built. Deeper than Phase 1's agentless discovery (a best-effort TCP+SNMP
network scan that only ever reads what's reachable from outside a device) — a
real lightweight background agent installed *on* a device: full hardware/software
inventory, OS patch level, disk-encryption/AV status, and — opt-in, higher trust
— remote script execution and software/patch deployment. Sequenced after Phase 4
deliberately: letting a fleet of real, privileged endpoints phone home safely is
much lower-stakes once the multi-tenant cloud hardening above already exists,
than bolting it onto an earlier phase.

**Explicitly desktop/server only — not Android/iOS in this phase.** Real mobile
MDM means enrolling as an Android Enterprise or Apple MDM device-policy
controller, a fundamentally different and much larger subsystem than a desktop
background agent — already correctly flagged below as "comparable in scope to
Microsoft Intune." Bundling it into this phase would be scope creep against the
project's own stated risk ("this is a large surface for a solo developer");
mobile MDM stays a separate, later, demand-gated decision.

**Security architecture (non-negotiable — this runs with real privilege on a
real endpoint, unlike everything else in this codebase so far):**

- **Per-device enrollment, never a shared secret.** A short-lived, single-use
  enrollment token mints a unique per-device credential — the same shape as the
  `ApiKey` pattern already used for the API/alert channels, just one per device
  instead of one per integration, so a single compromised device can't act as
  every device.
- **TLS-only transport**, agent verifies the server's certificate — the same
  "force HTTPS" posture as the rest of this project, not an exception for agent
  traffic.
- **Capability tiers, mirroring Phase 3's `AutonomyPolicy`** — the same "default
  to the safest tier, opt in to more" shape applied to a different kind of
  autonomous actor:
  1. Inventory-only (read-only) — the default.
  2. Remote script/command execution — opt-in per tenant, every run audited.
  3. Software/patch deployment — highest trust tier, opt-in, capped.
- **Every remote action gets a real audit log entry.** This is what makes the
  "real security-event audit log" already flagged as deferred in the security-
  hardening pass load-bearing rather than nice-to-have — the same relationship
  `AiAgentRun` has to Phase 3's autonomous AI mode.
- **Signed agent binary and signed auto-update**, verified before executing — an
  agent able to silently update itself is the single highest-value supply-chain
  target against every tenant running it.
- **Data minimization**: hardware/software/patch/AV inventory only, never
  arbitrary file access, keystrokes, or screen content — both a security-exposure
  and an operator-compliance boundary, deliberately not crossed.

Unlocks two Backlog items below that currently have no path without it
(Antivirus Management, Application Deployment) and the desktop half of a third
(MDM/MAM) — mobile stays out of scope per above.

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
- **Contract/license/financial asset management** (added 2026-09-16, from the
  same competitive pass as Phase 2's new items above): contracts, warranties,
  and purchase orders linked to an `Asset`/`AssetModel` — GLPI's strongest
  differentiator against every other tool checked. Same relationship as Data
  Center Management above: a specialization of Asset Management once there's
  real signal a tenant wants the financial side tracked here rather than in
  whatever accounting/procurement system they already use, not something to
  build speculatively ahead of that signal.
- ~~**Governance Helping**~~ — resolved into **IT processes/procedures**, see
  Phase 2 above, now that there's concrete direction instead of GLPI's broad
  label.
- **Antivirus Management**: tracking AV deployment/status per endpoint — needs
  Phase 5's endpoint agent (or an AV vendor's API integration as an alternative
  path); neither exists yet.
- **Application Deployment**: pushing software to endpoints — needs Phase 5's
  endpoint agent (fundamentally different from Phase 1's agentless discovery,
  which only ever reads).
- **Mobile Device/Application Management (MDM/MAM)**: Phase 5 covers the desktop
  half (an agent is an agent); real mobile MDM (Android Enterprise / Apple MDM
  enrollment) stays its own significant subsystem (comparable in scope to e.g.
  Microsoft Intune), effectively a separate product — revisit only if there's
  real demand, not preemptively.

**Other**: mobile apps, voice/telephony, BPMN-style workflow automation, SSO/SAML,
per-tenant data residency, console i18n. (Third-party plugin marketplace resolved
into the contract-based extension recommendation in Phase 2 above.)

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
- Phase 5's endpoint agent is a categorically bigger trust boundary than anything
  else in this project — everything before it runs inside Seredina's own
  infrastructure; an agent runs with real privilege on a customer's real machine.
  Ship inventory-only by default, remote-execution capability tiers opt-in and
  audited, per-device credentials, and signed auto-update, all from day one of
  that phase — retrofitting any of those onto an already-deployed agent fleet is
  far more painful than building them in from the start.
- A native code-loading plugin system (rejected in favor of a contract-based one,
  see Phase 2) would have been a direct route around the RLS + Prisma-extension
  tenant isolation this whole project is built on — worth remembering if a future
  session is ever tempted to add one for convenience.
- The SLA engine's business-hours math (`packages/shared/src/sla.ts`) holds a
  single UTC-offset constant for an entire due-date calculation rather than
  using a real timezone library — a calculation that straddles a DST transition
  in a DST-observing timezone can be off by that transition's shift. See
  `docs/adr/0011-sla-engine.md`. Fine for now (SLA windows are hours to days,
  DST-straddling is rare, the failure mode is a due date off by an hour); revisit
  if a tenant in a DST-observing region reports it.
- Dev-environment hygiene: `npm run dev` restarts across a long session leave
  orphaned `tsx watch` processes behind rather than actually freeing the port
  (only the newest one ever wins `EADDRINUSE`), and `/auth/login`'s deliberately
  generic error response can mask an underlying `DATABASE_URL`/infra problem as
  an ordinary wrong-password error. Neither is a product bug, but both cost real
  debugging time this pass (see `docs/adr/0011-sla-engine.md`) — worth a real
  `npm run dev:clean`-style script (kill-by-port before start) if this keeps
  costing time.
