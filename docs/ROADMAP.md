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
- ✅ *Resolved, ADR 0056:* A ticket doesn't remember which specific `EmailChannel` it arrived through —
  outbound send just picks the tenant's first active one. Fine for one channel per
  tenant (the expected case); needs `Ticket.emailChannelId` before multiple email
  channels per tenant are meaningfully supported.
- ✅ *Resolved, ADR 0056:* No email attachment handling (`mailparser` extracts them; nothing stores/surfaces
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
audit log (✅ since shipped, ADR 0058), tenant-slug enumeration on `/auth/register`) are deliberately deferred,
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
modes, so it can't bypass isolation regardless of who wrote it. **Decided
2026-09-16, no longer just a recommendation**: a self-hosted-only native
plugin loader was considered and explicitly rejected too, even though the
tenant-isolation argument above doesn't technically apply there (only one
tenant, nothing to leak to) — the user's call was that a curated set of real,
pre-built integrations ships more usable feature surface than a generic
loader would, without ever needing a plugin capability/permission model at
all. See the Backlog section's "Extensibility" note for the final framing:
integrations, not a plugin platform, in either deployment mode.

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

**Known conceptual simplification, verified against ITIL 4's actual Service
Level Management practice (added 2026-09-16):** ITIL formally separates three
layers of agreement — the customer-facing SLA, an **OLA** (Operational Level
Agreement) between internal teams, and a **UC** (Underpinning Contract) with
an external supplier. `SlaPolicy` only models the SLA layer. Not a bug to fix
now: an OLA is naturally a target between `Team`s (already a model) and a UC
is naturally the contract/license/financial asset management backlog item
already noted below — both have a natural home once/if they're built, neither
needs a new concept invented today. Documented here so this is a deliberate,
known scope cut, not an oversight if it comes up later.

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

**Reporting v1 + an interactive, configurable home dashboard ✅ (this pass)** —
`modules/reporting/service.ts` aggregates ticket volume (daily, 14-day window),
open-ticket priority breakdown, SLA compliance (met vs. breached, comparing
`resolvedAt` to `resolutionDueAt`), agent workload (open tickets per assignee
plus unassigned), channel breakdown, and recent activity — all in JS after a
single `findMany` through the normal RLS-gated path, not SQL `GROUP BY` (see
`docs/adr/0012-reporting-and-dashboard.md` for why that's a deliberate scope cut
tied to a future cost signal, not an oversight). `/dashboard` is now the default
landing page (`/` and both `Login.tsx`/`Register.tsx`'s post-auth redirect all
point there), built from a fixed catalog of five widgets — a hand-rolled SVG bar
chart for volume, progress-bar/list widgets for the rest, no charting library.
"Configurable" means show/hide and reorder per user (`DashboardWidget`, the same
"no row = default" shape `SlaPolicy` already established), not free-form
drag-and-drop positioning — a real scope cut for a five-widget first pass, not
what was originally sketched as a drag-and-drop grid, revisit if the widget
catalog ever grows enough to need it.

Verified: 10 integration tests against real Postgres covering every aggregation
function's edge cases (empty days still bucketed, closed tickets excluded from
priority/workload, SLA compliance excluding not-yet-resolved and no-target
tickets, recent-activity ordering and limit) plus the dashboard-prefs default/
override/reject-unknown-type behavior. Full suite 39/39 green. Browser-verified
end to end against real demo data: login now lands on `/dashboard` (a real bug
caught in the first verification pass — both auth pages had a hardcoded
`/tickets` redirect that bypassed the new default entirely), all five widgets
render real aggregated data including an honest empty state where the demo data
genuinely has none yet, and hiding a widget survives a full page reload —
proving the per-user preference actually round-trips through the API, not just
local state. Zero console errors.

**Deep customization, as an explicit cross-cutting goal (added 2026-09-16 at
the user's request), not just a side effect of individual features.** Already
true in practice — tenant-defined statuses, custom fields, macros, SLA
policies, and (once built) the Service Catalog and dashboard above all let a
tenant shape its own instance without filing a ticket against Seredina
itself. Naming what's still missing to make that a *complete* story:
**Tenant branding / white-label ✅ (this pass, v1 scope: portal + status page, not
login/register).** A `Tenant.branding` jsonb blob (`logoUrl`, `accentColor`) —
`GET`/`PATCH /tenant-branding` (authenticated) plus an unauthenticated
`GET /public/:tenantSlug/branding` for the 3 public pages, which now render a
shared `PortalBrand` component instead of Seredina's hardcoded logo/wordmark.
`Login`/`Register` deliberately excluded from v1 — they have no `tenantSlug` in
the URL to key a live-branding fetch off until the user starts typing it, unlike
the public pages (`/kb/:tenantSlug`, `/status/:tenantSlug`); a real fix needs a
URL-based login scheme, a routing change out of scope here. The internal admin
console stays Seredina-branded on purpose (ADR 0042's One Accent Rule) — this is
about what a tenant's *own customers* see, not the agent's own tool. See
`docs/adr/0043-tenant-branding.md`.
- **Editable outbound email templates.** Every outbound email the
  `EmailChannel` sends today (Phase 1 ✅ — a reply on an email-sourced ticket)
  uses one fixed, hardcoded format. A tenant should be able to edit the
  subject/body per event type (new reply, ticket resolved, ...) with a small
  placeholder system (`{{ticket.subject}}`, `{{contact.name}}`, ...) —
  `EmailTemplate` (tenant-scoped, one row per event type, falls back to a
  built-in default when a tenant hasn't customized one). Reuses the same
  `Tenant.branding` blob above for a logo in the template, rather than a
  second place to configure it.
**Saved views / filters per agent ✅ (this pass)** — "My open tickets,"
"Unassigned + urgent" as named, reusable filters an agent saves once
instead of rebuilding every session. `ListTicketsFilter` gained
`assigneeId` (a real user id, or the sentinel `'unassigned'`) and
`priority` alongside the existing `statusCategory`; `SavedView.filters` is
a validated jsonb blob, per-agent (`userId`, mirroring `DashboardWidget`'s
exact shape) rather than tenant-wide — two agents both naming a view "My
open tickets" is the expected case, not a collision. No `'me'` sentinel
needed: a saved view is only ever read back by its creator, so baking their
own user id in at save time already means the same thing. See
`docs/adr/0021-saved-views.md`.

Verified: 5 new integration tests against real Postgres (per-user scoping
and uniqueness; deleting another user's view rejected as not-found, not
forbidden; a view's stored filters actually narrow `listTickets` when
applied, including the `'unassigned'` sentinel), full suite 96/96 green,
both `apps/api`/`apps/web` typecheck clean. Browser-verified end to end:
filtered the queue to URGENT priority, saved it as a named view, cleared
filters, re-applied the view via its chip, and deleted the chip — all
correctly narrowing/restoring the ticket list. Zero console errors.
**Notification preferences per agent ✅ (this pass)** — email vs. in-app,
per event type. Two trigger events for v1: `TICKET_ASSIGNED` and
`NEW_REPLY` (a contact's reply landing on a ticket that already has an
assignee) — the two highest-value cases, not the full space of "ticket
activity." "No row = default" (`inApp: true`, `email: false`), same posture
as `SlaPolicy`/`DashboardWidget`. The email-sending logic is duplicated
across `apps/api` (fires from `updateTicket`) and `apps/worker` (fires from
its own inbound-email ingest) rather than shared, for the same
`apps/worker`-never-imports-`apps/api` reason ADR 0020's escalation engine
already established — both producers target one queue name, only
`apps/worker` consumes it. No digest mode yet — deferred, not built. See
`docs/adr/0022-notifications.md`.

Verified: 8 new integration tests against real Postgres (default
resolution, per-event-type preference isolation, per-user scoping,
mark-read/mark-all-read, assignment notifying only on a genuine change to a
new assignee), full suite 104/104 green, all three of
`apps/api`/`apps/web`/`apps/worker` typecheck clean. Browser-verified end
to end: assigned a ticket to a second agent, confirmed the bell badge and
dropdown, clicked through to the ticket, confirmed the badge cleared, and
confirmed a toggled email preference persists after reload. Also caught
and fixed an unrelated pre-existing bug found during verification: a race
in `Users.tsx` where creating a user could silently fail if the roles list
hadn't loaded yet when the "New user" modal opened. Zero console errors.
- Custom roles (already listed under Phase 4 below) and the Service Catalog's
  per-request-type forms (already added above) both belong to this same
  theme — listed once each, not repeated here.

**Added 2026-09-16, from a competitive pass against Jira Service Management, GLPI,
and ManageEngine ServiceDesk Plus — see the research notes below each item.
Ordered here roughly by how directly each one builds on something already
shipped, not by external priority:**

**Agent collision detection + ticket merge + bulk actions ✅ (this pass)** —
the three items that showed up as "must-have" in essentially every source
checked, and the cheapest of everything in this addition. Collision
detection is a Redis short-poll heartbeat (20s TTL key per tenant+ticket+
user, refreshed every 8s), not a WebSocket — no WS infrastructure exists in
this codebase yet, and building one would have been a much bigger lift than
this item's own "cheapest of everything" framing promised. Merge folds one
ticket's messages into another's and closes the source, reusing
`ingestAlert`'s re-fire-folding mechanism rather than inventing a new one; a
`mergedIntoId` self-relation (not explicitly named in this note, but the one
addition beyond "fold and close" needed so a merged ticket doesn't just look
like an ordinarily-closed one) records the redirect permanently. Bulk
actions (assign/set status/set priority on several tickets from the queue)
are UI + a loop over the existing single-ticket `updateTicket` — exactly as
described, no new backend endpoint at all for that part. See
`docs/adr/0019-collision-merge-bulk-actions.md`.

Verified: 9 new integration tests against real Postgres and Redis (merge
moves messages and adds system notes on both sides; the source closes and
gets a `resolvedAt`; the target's `mergedTickets` lists the source;
self-merge, re-merging, and merging into an already-merged target are all
rejected; presence correctly excludes the caller and is scoped per ticket
and per tenant), full suite 82/82 green, both `apps/api`/`apps/web`
typecheck clean. Browser-verified end to end: merged one ticket into
another and confirmed both sides' banners/notes; created a second, distinct
agent account and confirmed "Also viewing: Second Agent" renders after the
heartbeat interval (an early test that logged into the same account twice
never triggered this — correctly, since presence excludes the caller's own
user, and two contexts sharing one account are not a collision); bulk-
assigned two tickets from the queue via the new checkboxes and confirmed
both picked up the new assignee immediately. Zero console errors.
**On-call scheduling + SLA escalation chains ✅ (this pass)** — the direct
sequel to the SLA engine, not a separate concern: where the breach webhook
(`sla.*_breached`) was the endpoint before, this adds what actually receives
it. `OnCallSchedule` + `OnCallShift` model "whoever's on shift right now";
one ordered `EscalationTier` chain per tenant (each tier notifying either a
fixed person or an on-call schedule) escalates through tiers when nobody
acknowledges in time, tracked by `EscalationRun`. The engine lives entirely
in `apps/worker` — it schedules its own follow-up delayed BullMQ job after
notifying each tier and re-checks live state when that job fires, the exact
same pattern `checkSlaBreach` already used, not a second scheduler. See
`docs/adr/0020-oncall-escalation.md`.

Verified: 9 new integration tests against real Postgres (schedule/shift
CRUD, `whoIsOnShift`, tier validation and ordering, the acknowledge path),
full suite 91/91 green, all three of `apps/api`/`apps/web`/`apps/worker`
typecheck clean. Browser-verified end to end **with the actual worker
process live**: set a 1-minute SLA, built a real 2-tier escalation chain,
created a ticket and never responded, then watched in real time (~2.5
minutes of actual delayed-job execution) the breach fire, tier 1 get
notified, tier 1 time out, tier 2 get notified, and the acknowledgement
banner update correctly after clicking Acknowledge. Zero console errors.
**Service Catalog ✅ (this pass)** — a tenant-defined list of *requestable
things* ("new laptop," "VPN access," "onboard a contractor"), each pointing
at its own form. The missing piece `docs/adr/0006-custom-fields.md` already
flagged as a known v1 limitation ("no drag-and-drop `TicketForm` layout
customization... a separate, larger GLPI-parity item") — deliberately kept
thin rather than building that full form builder: `ServiceCatalogItem` is
just `name`, `description`, `icon`, and which `CustomFieldDefinition`s (by
key) it asks for. Requesting an item calls the exact same
`createTicketFromApi` every other channel already uses (now accepting an
optional `channel`/`customFields`), creating a `Ticket` on a new `catalog`
channel value, pre-filled with the requester's answers. This also became the
first agent-facing manual ticket-creation path — the Tickets queue's new
"New ticket" button opens the catalog request flow directly, since a
standalone blank-ticket form was out of scope for this item. See
`docs/adr/0016-service-catalog.md`.

Verified: 6 new integration tests against real Postgres (duplicate names
rejected; `sortOrder` increments correctly; requesting an item creates a
`catalog`-channel ticket with the requester upserted as its contact and the
given custom fields stored; an explicit subject overrides the item's name
while a blank one falls back to it; requesting a nonexistent item is
rejected; delete works and a second delete is rejected), full suite 58/58
green, both `apps/api`/`apps/web` typecheck clean. Browser-verified end to
end: created a custom field, created a catalog item with an icon and that
field attached, requested it from the Tickets page's new "New ticket"
button, and confirmed the resulting ticket's subject, channel badge, message
body, contact, and custom field value all render correctly on its detail
page. Zero console errors.

**Change Enablement ✅ (this pass)** — ITIL 4's official name for this practice
("Change Management" in the original note here was ITIL v3 terminology,
corrected after checking against the actual ITIL 4 practice list). Built as a
`ProcessTemplateKind` (`GENERAL` | `CHANGE`) on the existing `ProcessTemplate`,
plus four nullable fields on `ProcessInstance` (`riskLevel`, `plannedStart`,
`plannedEnd`, `rollbackPlan`) — not a new subsystem. Every mechanism already
proven by IT Processes (Phase 2 ✅) carries over unmodified, including the
approval-gated step type, which is all a CAB-style sign-off needs. `riskLevel`
is required when starting a `CHANGE` instance (a Change with no risk
assessment isn't following the practice); the planned window and rollback plan
stay optional, a deliberate first-pass scope cut. See
`docs/adr/0013-change-enablement.md`.

Verified: 4 new integration tests against real Postgres (a `GENERAL` template
never requires a risk level; starting a `CHANGE` instance without one is
rejected; risk level/planned window/rollback plan all persist correctly for a
real Change instance while its approval-gated step works completely
unmodified; a risk level sent against a `GENERAL` template is confirmed not
stored), full suite 43/43 green, both `apps/api`/`apps/web` typecheck clean.
Browser-verified end to end: created a Change template with a CAB-approval
step, started a HIGH-risk instance with a rollback plan, confirmed the risk
badge and Change Enablement panel render correctly on both the list and
detail pages, and confirmed the CAB step still only offers
APPROVED/REJECTED/SKIPPED, never a plain DONE — zero console errors.
**Release Management ✅ (this pass)** — ITIL 4 treats this as its own practice,
distinct from Change Enablement: a Change is the *decision and approval* to
make a change; a Release is *actually making it available to users*. Same
reuse story as Change Enablement — built as a third `ProcessTemplateKind`
(`RELEASE`) plus `releaseVersion` and a self-relation `changeInstanceId` on
`ProcessInstance` (linking a Release back to the Change that approved it);
`plannedStart`/`plannedEnd`/`rollbackPlan`, already added for Change
Enablement, are reused as-is rather than duplicated. `releaseVersion` is
required when starting a `RELEASE` instance; the Change link, planned window,
and rollback plan stay optional. See `docs/adr/0014-release-management.md`.

Verified: 4 new integration tests against real Postgres (starting a `RELEASE`
instance without a version is rejected; version, an optional link to a real
`CHANGE` instance, planned window, and rollback plan all persist correctly
while `riskLevel` stays null; a nonexistent `changeInstanceId` is rejected; a
version sent against a `GENERAL` template is confirmed not stored), full
suite 47/47 green (9 skipped, unrelated), both `apps/api`/`apps/web` typecheck
clean. Browser-verified end to end: created a Change template and a Release
template, started a Change instance, started a Release instance with a
version linked to that Change plus a rollback plan, confirmed the version
badge and Release Management panel — including a working link to the linked
Change's detail page — render correctly on both the list and detail pages,
and confirmed the Change instance's own Change Enablement panel still renders
unmodified alongside it. Zero console errors.
**Problem Management ✅ (this pass)** — distinguishing a root cause
("Problem") from the individual incidents it's causing, the way Jira Service
Management and ITIL 4 both treat it: a first-class, separate concept from
ticket/incident. Built as its own small `Problem` model — deliberately
**not** another `ProcessTemplateKind` like Change/Release Management, since a
Problem isn't a checklist, it's a root cause with a workaround and a set of
linked tickets. A one-way `Ticket.problemId` links many tickets to one
Problem, reusing the existing ticket `PATCH` endpoint rather than adding a
new one; `Problem.number` is sequential per tenant, generated the same way
`Ticket.number` already is; an optional `changeInstanceId` links to the
Change that shipped the fix, same reasoning Release Management already
established. See `docs/adr/0015-problem-management.md`.

Verified: 5 new integration tests against real Postgres (sequential
numbering starting `UNDER_INVESTIGATION`; linking/unlinking tickets via the
existing ticket-update path actually connects/disconnects; `resolvedAt` sets
on the first `RESOLVED`/`CLOSED` transition and clears on reopening; an
optional Change link persists and a nonexistent one is rejected; the list
orders newest-first), full suite 52/52 green, both `apps/api`/`apps/web`
typecheck clean. Browser-verified end to end: created two real tickets via
the API-key path, created a Problem, linked both tickets from the Problem
page, filled in root cause/workaround (auto-saved on blur, survives reload),
moved status to `KNOWN_ERROR`, unlinked one ticket and confirmed it dropped
off the list, and confirmed the other ticket's own detail page shows a
working "Problem" dropdown plus a back-link into the Problem page. Zero
console errors.
**Service Configuration Management ✅ (this pass)** — sharper and more
specific than the general "CMDB relationship depth" concern already flagged
in Phase 1/2: the ITIL practice of mapping which technical assets actually
underpin which *business service*, not just asset-to-asset or asset-to-
contact links. A `Service` record (`name`, `description` — deliberately no
status field; "current status" is the already-planned public-status-page
differentiator's job, derived from open alert tickets rather than
manually maintained) links to `Asset`s via a many-to-many `ServiceAsset` join
table, mirroring `TicketAsset`'s exact shape. A ticket's existing "linked
assets" panel now also shows which Services each linked asset underpins —
"Affects: Payroll" — entirely from data `getTicket` already fetched, no new
ticket-level field. See `docs/adr/0017-service-configuration-management.md`.

Verified: 7 new integration tests against real Postgres (duplicate service
names rejected; linking two assets to a service lists both; one asset can
underpin more than one service at once; unlinking removes the join row
without deleting either side; linking a nonexistent asset or service is
rejected; a ticket linked to an asset shows the services it affects; delete
works and a second delete is rejected), full suite 65/65 green, both
`apps/api`/`apps/web` typecheck clean. Browser-verified end to end: added
two assets, created a service and linked both, created a ticket via the
API-key path, linked the affected asset from the ticket's own panel, and
confirmed "Affects: Email" renders correctly. Zero console errors.
**Self-service portal + a browsable knowledge base ✅ (this pass)** — a real
gap, not a duplicate of Phase 3's RAG plan below: `KbArticle` as a plain,
human-browsable CRUD resource (a contact can read and search it directly)
*before* anything AI-related touches it. Phase 3's `pgvector` embeddings and
`search_knowledge_base` tool land later as an enhancement layered onto these
same rows, not the reason they exist. `slug` is derived from `title` once at
creation and never changes, even if the title is edited later (a stable,
bookmarkable public URL); `published` defaults to `false`, and both public
service functions filter on it themselves rather than trusting every future
caller to. The public portal (`/kb/:tenantSlug`, no login) resolves its
tenant via `resolveTenantIdBySlug()` — the exact mechanism login/register
already use, since a Contact has no Seredina account to authenticate with in
the first place. See `docs/adr/0018-knowledge-base.md`.

Verified: 8 new integration tests against real Postgres (default-unpublished
with a derived slug; duplicate titles get a deduped `-2` slug; editing the
title never changes the slug; search matches title or body
case-insensitively; the public functions never return a draft, by list or by
direct slug lookup; publishing toggles public visibility without touching
the slug; tenant-slug resolution works and returns null for a nonexistent
one; delete works and a second delete is rejected), full suite 73/73 green,
both `apps/api`/`apps/web` typecheck clean. Browser-verified end to end:
created a draft and a published article from the admin page, confirmed
search finds an article by body text, then — in a separate, unauthenticated
browser context — visited the public portal, confirmed the draft never
appears there, read the published article, and confirmed both public routes
404 cleanly for a draft slug and for a nonexistent tenant slug. Zero console
errors.

**Differentiators (added 2026-09-16, at the user's explicit request for
"what would set this apart, not just close the gap") — deliberately NOT
competitive parity. The point of everything else in this phase is closing
gaps against Jira SM/GLPI/ServiceDesk Plus; these three are things none of
them do, chosen because each one is cheap specifically because it reuses a
piece already being built for another reason:**

**A public status page, auto-driven by Service Configuration Management + the
alert channel ✅ (this pass, differentiator 3 of 3)** — shows which business
`Service`s are currently affected and why, in real time, with zero manual
maintenance: Atlassian sells this as a separate product (Statuspage) on top
of Jira SM; GLPI and ServiceDesk Plus don't offer it at all. No new table —
derived entirely from `Service`→`Asset` links (Service Configuration
Management, already shipped) and open `channel: 'alert'` tickets tagged with
an affected asset via the CMDB's existing ticket-asset linkage. Three levels
(`operational`/`degraded`/`outage`), derived from ticket priority, not a
fourth data field. The privacy/scoping decision the roadmap flagged as the
real work: an anonymous visitor sees a service name, a status, and a bare
incident *count* — never a ticket subject, description, or Asset detail
(hostname, IP, type). `GET /public/:tenantSlug/status` needs no auth, same
posture as the KB public portal (ADR 0018), resolving the tenant via the same
`resolveTenantIdBySlug()` mechanism. See `docs/adr/0025-public-status-page.md`.

Verified: 6 new integration tests against real Postgres (operational with no
incidents; degraded at LOW/NORMAL priority; outage at HIGH/URGENT and it
bumps the tenant-wide overall; a non-alert-channel ticket on the same asset
is correctly ignored regardless of priority; closing the alert ticket
returns the service to operational; cross-tenant isolation holds), full
suite 118/118 green, both `apps/api`/`apps/web` typecheck clean.
Browser-verified end to end: registered a tenant, built the CMDB fixture
(asset + service + link) via the authenticated API, fired a real
`POST /v1/alerts` with `severity: 'CRITICAL'` through an API key exactly as a
real monitoring tool would, tagged the resulting ticket with the asset, then
confirmed the internal Services page's new hint shows the real
`/status/<slug>` URL and — in a separate, unauthenticated browser context —
the public page shows "Major outage affecting one or more systems" and
"Email: Outage (1 active incident)." Confirmed the alert's own title never
appears anywhere in the public page's rendered text, proving the
privacy/scoping decision holds through the real HTTP response. Zero console
errors.
**AI cost transparency, per ticket and per tenant ✅ (this pass)** — because
the `LlmProviderAdapter` is already bring-your-own-key, Seredina can show a
tenant exactly what each AI action cost in real dollars, something no
per-seat SaaS competitor bundling AI into its price can offer. A lightweight
`AiUsageLog` (action, model, input/output token counts, estimated cost —
`action` a plain string, extensible without a migration, matching
`DashboardWidget.widgetType`'s posture) is written by `suggestReply`/
`summarizeTicket` right after each real call, with Phase 3's fuller audit
trail extending this same table rather than replacing it. Pricing lives in
code (`packages/ai-adapters/src/pricing.ts`), not a DB table — a model's
price is a fact about the code that calls it, not tenant data — and an
unrecognized model logs real token counts with a null cost rather than a
guessed number. Per-ticket usage is `tickets:read`; the tenant-wide summary
(its own new "AI Usage" page, in the Configuration group) is
`tickets:manage_all`. See `docs/adr/0023-ai-cost-transparency.md`.

Verified: 4 new integration tests against real Postgres (real token counts
logged with a null cost for an unpriced test model; summarize and
suggest-reply log under distinct actions; the tenant summary aggregates
correctly by action across tickets and never substitutes a guessed cost;
a ticket with no AI activity reports a clean zero), full suite 108/108
green, both `apps/api`/`apps/web` typecheck clean, `packages/ai-adapters`'
own suite still green after adding `model` to `CompleteResult`.
Browser-verified: the AI Usage page's zero state and a ticket's absent cost
pill both render correctly. The live Anthropic network call itself was
deliberately not re-exercised in this pass (this session works with the
user's own credit-limited key) — the logging path is fully covered by the
integration tests via `TestProviderAdapter`, which runs the identical code
a real call would. Zero console errors.
**Full data portability — a one-click export in an open format ✅ (this
pass)** — a single `GET /export` returning every tenant-scoped table (all
~35 of them, minus `Notification`/`DiscoveryJob` — transient state, not
data worth migrating) as one JSON file. The honest opposite of how Jira
and ServiceDesk Plus treat migrating *away* from them — deliberately
painful, by design, for a vendor whose business model depends on lock-in.
Seredina's doesn't: AGPL-3.0 and a self-hosted path already say "you own
this" implicitly; this makes it a real, provable feature instead of a
licensing technicality nobody notices. Secrets (password hashes, API key
hashes, email-channel/webhook encrypted credentials) are redacted via an
explicit `select` allowlist on the four models that hold them, not a
denylist — a future field added to any of those models can't silently leak
into an export by default. Every query runs inside one `withTenantTx` via
`Promise.all`, the same low-risk pattern every other multi-table read in
this codebase already uses. See `docs/adr/0024-data-export.md`.

Verified: 4 new integration tests against real Postgres (real data across
multiple tables; every secret field genuinely absent from the exported
rows, checked both structurally and by string search for the plaintext
test passwords; `notifications`/`discoveryJobs` absent from the export
entirely; cross-tenant isolation holds both directions), full suite
112/112 green, both `apps/api`/`apps/web` typecheck clean.
Browser-verified end to end via Playwright: registered a fresh tenant,
clicked "Download export" on the new Data Export page, captured the real
browser download event, and parsed the saved file — tenant record present,
no `passwordHash`, no `notifications` key. This pass caught a genuine bug:
`Content-Disposition` isn't on the cross-origin default-exposed header
list, so the download silently fell back to a generic filename until
`exposedHeaders: ['Content-Disposition']` was added to the API's CORS
config — re-verified clean afterward with the correct
`seredina-export-<slug>-<date>.json` name landing. Zero console errors.

**Onboarding & installation experience (added 2026-09-16, at the user's
request) — a cross-cutting concern, not tied to one phase, since both a
self-hosted install and a cloud signup need it:**

- **A real setup wizard for self-hosted Docker installs.** This session's own
  repeated friction restarting the dev API server (wrong `DATABASE_URL`,
  regenerated `JWT_SECRET`/`ENCRYPTION_KEY` by hand, a masked error that
  turned out to be a stale port) is a preview of exactly what a first-time
  self-hoster would hit blind, with nobody to ask. A one-shot
  `docker compose up` should be followed by a web setup wizard — generate and
  save the secrets, create the first tenant/admin, verify the DB/Redis
  connection with a visible pass/fail instead of a silent hang — not a README
  telling someone to export nine environment variables correctly by hand.
**A first-run product tour after signup/first login ✅ (this pass).** Landed
as a Dashboard widget (`onboarding_checklist`, shown first, dismissible for
free via the existing per-user widget hide toggle) rather than a separate
flow — matches the roadmap's own framing that "the first widget you see is
literally the tour's checklist." Four items, derived from real tenant data
on every load rather than a one-time flag: customize your ticket statuses,
set an SLA policy, create a macro, invite a teammate. All four done renders
a completed state instead of a stale checklist. See
`docs/adr/0030-ticket-statuses-and-onboarding-tour.md`.

Building this surfaced a real, separate gap: **there was no way to create,
edit, reorder, or delete a ticket status anywhere in the app** — the schema
supported it, `seedDefaultTicketStatuses` was the only caller of
`ticketStatus.create`. Fixed first, as its own Configuration page (Ticket
Statuses), since the tour's own first item depended on it existing. The
status whose key is `open` is specially protected (can't be deleted, can't
be recategorized out of `OPEN`) because ticket creation looks it up by that
literal key, not by category — every other status is fully editable.

Verified: 12 new integration tests against real Postgres (status CRUD:
create/duplicate-key rejection/edit-with-key-immutable/open-status
protection-both-ways/delete-blocked-while-occupied/reorder; onboarding
checklist: starts fully undone, each item flips independently only when
the tenant does the real thing, ends fully done), full suite 155/155 green,
both `apps/api`/`apps/web` typecheck clean. Browser-verified end to end:
registered a tenant, confirmed the checklist widget renders first and
fully unchecked, exercised the full Ticket Status CRUD (create/edit/
reorder/delete, confirmed "open" has no delete control), then genuinely
set an SLA policy, created a macro, and invited a teammate through their
real pages and watched the checklist widget flip to its completed state on
reload. Zero console errors. Along the way, the Configuration nav group
hit 11 flat items and was split into **Configuration** and **Operations** —
this app's own ~8-item grouping threshold, already documented in
`Layout.tsx`, would otherwise have been violated by the same change that
triggered it.

**A real setup wizard for self-hosted Docker installs ✅ (this pass, scoped
down from the original framing).** The design pass ADR 0030 deferred this
for found the actual gap much smaller than "a web wizard": creating the
first tenant/admin was already fully solved by the existing `/register`
flow (identical in self-hosted and cloud mode). What was missing reduced to
three concrete, non-UI pieces —

- `./scripts/setup.sh`: generates and writes `.env` with fresh
  `POSTGRES_PASSWORD`/`APP_TENANT_DB_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY`
  (idempotent — never touches an existing `.env`), replacing "copy
  `.env.example` and fill in nine variables by hand." This is the piece
  that structurally can't be a web wizard: the API process hard-requires
  `JWT_SECRET`/`ENCRYPTION_KEY` as env vars before it can boot at all, so
  the server that would serve a web wizard can't start without them first.
- A real Redis healthcheck in `docker-compose.yml`, with `api`/`worker`'s
  `depends_on` moved from `service_started` to `service_healthy` — matching
  the treatment Postgres already had. Before this, a slow or misconfigured
  Redis was invisible until something further downstream failed more
  confusingly.
- One aggregate env-var validation per app (`apps/api`/`apps/worker`'s new
  `lib/startupCheck.ts`, deliberately the first import in each `index.ts`),
  reporting every missing/malformed required var in one message instead of
  the previous one-at-a-time discovery loop (several modules already threw
  their own single-variable error at import; this runs before any of them
  can, by being first in `require()` evaluation order) — including
  validating `ENCRYPTION_KEY`'s exact-64-hex-characters format up front
  rather than failing confusingly later inside an actual encrypt/decrypt
  call.

See `docs/adr/0031-self-hosted-startup-checks.md`.

Verified: 4 new unit tests for the aggregate check (passes with everything
valid; lists every missing var, not just the first; rejects a wrong-length
or non-hex `ENCRYPTION_KEY` with the specific problem named), full suite
159/159 green, both `apps/api`/`apps/web` typecheck clean.
`scripts/setup.sh` verified directly: generated secrets are the exact
required lengths, re-running it against an already-populated `.env` is a
no-op (confirmed byte-for-byte unchanged), and `docker-compose.yml` still
parses as valid YAML. The startup check was verified against the real
application entry points via `tsx` directly (not a mock): invoking
`apps/api`/`apps/worker`'s actual `index.ts` with no env vars produced the
complete missing-vars list for each app; a deliberately-too-short
`ENCRYPTION_KEY` reported its actual character count; with everything
valid, `apps/api` proceeded all the way to Fastify attempting to bind its
port. **Not verified**: an actual `docker compose up` of the full stack —
this sandboxed environment has neither the `docker compose` plugin nor the
standalone binary (a known environment quirk this session already
diagnosed once before), so the real multi-container orchestration path
remains unverified end-to-end; a real self-hosted operator running this
for the first time is still this feature's true validation.

## Phase 3 — AI depth: RAG + MCP + autonomous mode

**pgvector `KbChunk` embeddings + semantic search grounding `suggestReply` ✅
(this pass)**, layered onto the plain `KbArticle` CRUD resource added in
Phase 2 — the articles needed to exist and be human-maintained first; this
made them AI-searchable, not the other way around. Anthropic has no
embeddings API, and the user is running against a credit-limited,
semi-compromised key this session — both real constraints, not
hypotheticals — so embeddings run **locally** (`@huggingface/transformers`,
`Xenova/all-MiniLM-L6-v2`, zero marginal cost, no new API key) behind a new
`EmbeddingProviderAdapter` interface deliberately designed to support other
providers (Voyage, OpenAI) later without touching call sites, per explicit
user direction. `KbChunk.embedding` is a Prisma `Unsupported("vector(384)")`
column — first use of a Prisma preview feature in this codebase — so every
read/write goes through raw SQL, with `tenant_id` filtered by hand on every
statement as defense in depth on top of Postgres RLS (which ADR 0001's
Prisma Client Extension can't reach for raw queries). `suggestReply` now
searches the KB before drafting, injects matched excerpts above a 0.45
cosine-similarity threshold, and returns `usedArticles` for a "Based on: ..."
provenance note in the ticket UI. See `docs/adr/0032-rag-knowledge-base-search.md`.

Verified: 10 unit tests (`packages/ai-adapters`, real local model, zero API
cost) covering chunking edge cases and that a related sentence pair scores
higher cosine similarity than an unrelated one. The `kb_chunks` table, its
HNSW index, and its forced RLS policy were confirmed directly against the
running dev database via `psql`, not assumed from the migration SQL. 5 new
live-Postgres integration tests (`apps/api/test/kb-rag-search.test.ts`, real
embeddings, real pgvector `<=>` search) prove: relevant-over-irrelevant
ranking, cross-tenant isolation for this raw-SQL path specifically, an empty
result for a KB-less tenant, `suggestReply` grounding actually reaching the
system prompt (via `TestProviderAdapter`, no real Anthropic call), and
graceful no-grounding degradation when nothing matches. Full `apps/api`
suite 164/164 green (9 skipped, unrelated), everything typechecks clean.
Full pipeline verified live end-to-end with the real dev stack running (no
mocks for create→enqueue→embed): a browser session created a real KB
article through the actual UI, and `psql` confirmed the real worker process
embedded it into a `KbChunk` row with a genuine 384-dim vector. Only the
final "Suggest reply" UI click had its network response mocked, deliberately
avoiding a real Anthropic API call whose backend behavior the integration
tests above already fully proved — that click confirmed the "Based on: VPN
Setup Guide" note renders correctly with zero console errors. **Known gap**:
the 0.45 similarity threshold and ~500-char chunk size are tuned against a
handful of synthetic sentence pairs, not real tenant KB content at scale.

**Shared AI tool catalog + `AutonomyPolicy` + `AiAgentRun` audit trail +
`apps/mcp-server` (stdio) ✅ (this pass).** Six tools (`get_ticket`,
`add_ticket_reply`, `set_ticket_status`, `assign_ticket`, `apply_macro`,
`escalate_to_human`) in `apps/api/src/modules/ai-tools/catalog.ts`, each a
thin wrapper over the exact service-layer function a human agent's own UI
action already calls — webhook dispatch, SLA stamping, notification emails
all happen for free, never a second implementation. A single executor
(`runTool`) is the one gate every AI actor goes through: read-only tools run
immediately with no audit row; a mutating tool either auto-executes (on a
per-tenant `AutonomyPolicy` allow-list, under a daily action cap) or is
recorded `PENDING_APPROVAL` in `AiAgentRun` without running, waiting for a
human to approve or reject from the new "AI Agent Activity" page (Operations
group). Default policy for a tenant that never configured one = nothing
auto-executes, the safest possible default per the original plan.
`apps/mcp-server` exposes the identical catalog over MCP's stdio transport —
`tenantId` resolved once from a `SEREDINA_API_KEY` at process start, never a
tool input argument — so a customer's own Claude Desktop/n8n/custom agent
operates under the same guardrails as Seredina's built-in copilot. HTTP/SSE
transport is explicitly deferred (see `docs/adr/0033-ai-tool-catalog-and-autonomy.md`
for why); this is the "open framework" requirement's first real slice, not
the whole of it yet.

Verified: 14 new integration tests (live Postgres) covering the full
gate — default-deny, read-only bypass, pending-then-approved, pending-then-
rejected, allow-listed auto-execute, the daily cap forcing a fallback to
pending, policy validation rejecting unknown/non-mutating tool names,
`set_ticket_status`'s key-based lookup, `escalate_to_human`'s note+unassign,
`apply_macro` running AI-authored, and the approve/reject guard rails against
already-resolved or nonexistent runs. Full `apps/api` suite 178/178 green.
The MCP wire protocol itself was verified with a real client and a real
spawned server process (the MCP SDK's own `Client`/`StdioClientTransport`),
not mocked: `tools/list`, a real `get_ticket` call, a real `add_ticket_reply`
call correctly deferred to pending approval, and clean protocol-level
rejections for an unknown tool name and invalid arguments — then the pending
run was approved through the real REST API and the reply's actual posting
was confirmed on the ticket, `authorType: "AI"`. The new frontend page was
verified live in a browser: tool checkboxes render from the real catalog
endpoint, and both the allow-list and the daily-cap setting persist across a
full page reload. **Known gaps, not silently skipped**: no automated Docker
build verification for `apps/mcp-server` (same sandbox limitation as ADR
0031). HTTP/SSE transport — since resolved, see below.

**`apps/mcp-server` Streamable HTTP transport ✅ (this pass)** — the stdio
transport's one remaining named gap. `MCP_TRANSPORT=http` runs a genuine
always-on Streamable HTTP service instead of a client-spawned stdio process;
deliberately **stateless** (a fresh `McpServer` per request, tenant
resolved fresh from that request's own API key every time) rather than
session-sticky, matching this codebase's existing "never cache tenant scope
across requests" posture (RLS/the Prisma extension both re-check on every
query) and its Phase 4 goal of stateless, replica-safe services. Tool
registration was extracted into one shared `createMcpServer(tenantId)` used
by both transports — no second implementation of the catalog wiring.
Profile-gated `mcp-server-http` service added to `docker-compose.yml`
(`docker compose --profile mcp up`), since — unlike stdio — an always-on
HTTP service is something compose can actually represent. See
`docs/adr/0035-mcp-http-transport.md`.

Verified real and live, not mocked: the actual server process, started
against the real dev stack, was driven by the MCP SDK's own real `Client` +
`StreamableHTTPClientTransport` — `tools/list`, a real `get_ticket` call,
and critically, a **second, fully independent client connection** making
its own `get_ticket` call with no shared state from the first, proving the
stateless design claim for real rather than just by design intent. An
invalid API key was cleanly rejected, never silently falling back to a
default tenant. `docker-compose.yml` re-verified as valid YAML. **Known
gap**: no automated test suite for either MCP transport (stdio or http) —
consistent with ADR 0033's own precedent of relying on real, documented
manual verification for this app rather than standing up new
cross-app test infrastructure for it.

**Second LLM provider (OpenAI + local Ollama) + the full autonomous
tool-use loop ✅ (this pass)** — both landed together, at the user's explicit
request to give a self-hosted operator a genuinely free/private local
option alongside a second cloud one, not just prove the adapter abstraction
works with one more vendor. `AI_PROVIDER` (`anthropic` | `openai` | `ollama`)
picks the copilot's backing adapter; unset keeps the pre-existing
Anthropic-if-configured default. `LlmProviderAdapter` grew provider-agnostic
tool-use support (`ToolSpec`/`ToolCall`/`ToolResult`, a richer `LlmMessage`
union, `CompleteResult.stopReason`) so `apps/api/src/modules/ai-tools/autonomousLoop.ts`
can let Seredina's own LLM decide which catalog tools to call, in a loop —
every tool call, regardless of caller, goes through the exact same
`runTool()` executor ADR 0033 built for MCP, with `source: 'autonomous'`
distinguishing these runs in the activity log. A per-run `MAX_ITERATIONS`
cap (5) now exists alongside `AutonomyPolicy`'s existing per-tenant daily
cap — the "known gap" noted above about no per-run cap existing is resolved.
A new "Let AI try" button on `TicketDetail` triggers it. See
`docs/adr/0034-second-llm-provider-and-autonomous-loop.md`.

Verified: 19 `packages/ai-adapters` unit tests (up from 16), including one
that runs for real against this sandbox's own already-running local Ollama
instance (skipped automatically where none exists). Live, manual, non-mocked
verification beyond the automated suite: a real local completion, a raw
`curl` against Ollama's own endpoint confirming tool definitions transmit
correctly, and the full `suggestReply` HTTP route run end-to-end with
`AI_PROVIDER=ollama` against a real ticket — real RAG search, a real
on-topic reply, and an `AiUsageLog` row showing `estimatedCostUsd: "0"` for
the local model, not the unpriced `null` an unrecognized cloud model gets.
6 new `ai-adapter-selection.test.ts` tests cover provider selection
including backward compatibility and an unrecognized `AI_PROVIDER` value
disabling AI rather than throwing. 6 new `ai-autonomous-loop.test.ts` tests
(live Postgres, fully deterministic via `TestProviderAdapter`'s new scripted
tool-call responses) cover the full loop: read-only tool results flowing
back to the model, a non-allow-listed mutating call genuinely not executing,
an allow-listed call auto-executing for real, a tool error reported back
without crashing, the iteration cap cutting off a runaway model, and
per-turn `AiUsageLog` rows. Full `apps/api` suite 190/190 green; every
touched workspace typechecks clean. **Known gaps, disclosed not hidden**:
tool-calling through Ollama is unreliable depending on the specific local
model/Ollama version (confirmed directly, not assumed — see the ADR); no
live Anthropic tool-use verification, to conserve the user's credit-limited
key.

## Phase 4 — Multi-tenant cloud hardening + more channels

**Self-hosted single-tenant enforcement + bring-your-own AI key + custom
roles ✅ (this pass).** Scoping found the first and third smaller than their
one-line descriptions implied: self-signup already worked identically in
both modes (slug collision, rate limiting, validation), the actual gap was
`SEREDINA_MODE` never being consulted at all -- a self-hosted deployment
(architecturally single-tenant) had no enforcement against a second,
orphaned tenant. Custom roles' schema was already fully generic and
`login()` already derives real permissions from live `RolePermission` rows,
never the hardcoded 3-role seed map -- only CRUD (`POST`/`PATCH`/`DELETE
/roles`, finally enforcing the long-defined-but-never-checked
`roles:manage` permission) was missing. **Plan-tier scaffolding is
deliberately not built** -- real pricing tiers are the user's own business
decision, not something to invent.

Bring-your-own AI key (`TenantAiSettings`, one row per tenant, "no row =
deployment default" shape) reuses `EmailChannel`'s exact established
AES-256-GCM secret pattern for the key itself. A tenant with its own
provider configured is used *exclusively* -- the deployment-wide env config
is never consulted as a fallback for a missing tenant key, so a
misconfigured tenant setting fails closed (AI unavailable) rather than
silently spending the deployment's own credit. New "AI Settings" page
(Operations) never re-displays a saved key, only whether one is set.

Verified: 16 new integration tests (2 self-hosted-gating, 7 BYOK including a
real AES-256-GCM round-trip proving the key isn't just a boolean flag, 7
custom-roles including one that calls the real `login()` to prove a custom
role's permission set is enforced for actual authorization, not just
manageable in a UI) -- full `apps/api` suite 206/206 green. Frontend
verified live in a browser end-to-end, including the strongest version of
the custom-roles check: create a role through the UI, then confirm it
*immediately* appears in the Users page's own role-assignment dropdown with
zero code changes needed there, proving the loop closes for real. See
`docs/adr/0036-phase-4-self-hosted-signup-byok-custom-roles.md`.

**Embeddable web chat widget ✅ (this pass) — the first of the "widget +
WhatsApp/Telegram" customer-facing channels.** One `<script>` tag
(`GET /widget.js`, `data-tenant="<slug>"`) drops a floating chat bubble on
any third-party website; a visitor's message becomes a real ticket
(`channel: "widget"`, reusing `createTicketFromApi`/`addMessage` like every
other channel). No login, no `ApiKey` — a random `widgetToken`
(`Ticket.widgetToken`, unique-indexed) held in the visitor's own
`localStorage` proves conversation continuity instead, scoped to its
tenant the same way every other RLS-backed lookup is. Caught and fixed a
real latent bug in `addMessage` while building this: `firstRespondedAt` was
stamped for any non-private message regardless of author, which would have
let a customer's own follow-up count as its own first response — never
exercised before, since a CONTACT message previously only ever existed as
a ticket's opening message, not a follow-up through `addMessage`.

The actual hard part was CORS: this channel needs permissive, any-origin
access on three specific routes while every other route in this API stays
locked to the operator's own `CORS_ORIGIN`. `@fastify/cors` is
`fastify-plugin`-wrapped, which breaks Fastify's encapsulation, so a second
scoped `cors` registration doesn't actually stay scoped. Fixed instead with
the plugin's own documented `config: { cors: false }` per-route opt-out
plus explicit `OPTIONS` handlers (needed because `@fastify/cors`'s own
preflight wildcard route would otherwise still answer first) and a plain,
correctly-encapsulated `onSend` hook that sets the real headers only for
widget routes. A second, independent, browser-only blocker
(`@fastify/helmet`'s global `Cross-Origin-Resource-Policy: same-origin`,
which blocks cross-origin loading regardless of CORS) was only caught by
testing in a real Playwright-driven browser, not `curl` — the same
`onSend` hook overrides it for these routes too. See
`docs/adr/0040-embeddable-widget.md`.

The widget script itself is hand-written vanilla JS served as a real `.js`
response (no bundler on a third-party page), using Shadow DOM for style
isolation rather than an iframe. No agent-facing UI change was needed —
`TicketDetail.tsx` already renders `<Badge>{ticket.channel}</Badge>`
generically, so `widget` tickets display correctly for free.

Verified: 7 new integration tests (start/follow-up/read, the
`firstRespondedAt` fix proven both ways, unknown-token rejection,
cross-tenant token isolation) — full `apps/api` suite 220/220 green, every
workspace typechecks clean. Verified live against the real dev stack,
`curl` first (preflight + real requests carry the right headers, full
happy path, wrong-token/wrong-tenant/cross-tenant all 404 identically,
`firstRespondedAt` genuinely stays null) and then, specifically because
this feature is cross-origin in a way nothing else in the app is, in a
real Chromium browser via Playwright serving the test host page from a
different origin/port than the API: bubble → pre-chat form → conversation
start → follow-up → page-reload resumption from `localStorage` → an agent
reply posted through the real ticket API appearing in the widget within
one poll cycle. Zero console errors. WhatsApp remains unbuilt. Re-scoped
2026-09-21 to match Telegram's own bring-your-own-credential shape (below) rather
than a Seredina-operated integration: a tenant does their own Meta Business
verification and WhatsApp Business Platform setup (their business, their
verification, not this project's), then pastes the resulting access token +
phone number ID into Seredina, same pattern as a Telegram bot token. Real,
disclosed extra scope beyond that credential exchange: WhatsApp requires a
Meta-approved message template for the first outbound message in any 24-hour
window (unlike Telegram, which has no such restriction) — a genuinely bigger
lift than Telegram's own integration, not a blocker on this project's side, but
not a small one either.

**Telegram channel ✅ (this pass).** A tenant connects their own bot (created via
`@BotFather`, no OAuth app registration needed — unlike Slack/Teams below, this had
no external blocker) from a new Settings > Telegram page; a message to it becomes
a ticket (`channel: 'telegram'`), and an agent's reply goes back as a real Telegram
message via a `telegram-send` BullMQ queue mirroring `EmailChannel`'s own outbound
shape. Threading reuses `Ticket.externalId` (the chat id) exactly like alert's own
re-fire dedup (ADR 0003) rather than a new column. Webhook security is two
independent values (an opaque `webhookId` routing the call, Telegram's own
`secret_token` header verifying it) since Telegram's webhook config has no custom
`Authorization` header the way Grafana's does. See `docs/adr/0044-telegram-channel.md`
— including a real bug (a customer's own follow-up message would have echoed back
to them) found live in dev before it shipped, not by the automated suite first.
**Slack and Microsoft Teams notifications ✅ (this pass) — re-scoped 2026-09-21
to bring-your-own, not a Seredina-operated OAuth app.** A single shared OAuth
app registered by this project would mean this project's own name goes through
Slack's/Microsoft's app-review process, and its approval, rate limits, and any
future review requirements become an ongoing maintenance burden with real
cost/risk for an unfunded open-source project — the same reasoning that keeps a
signed agent installer out of Phase 5. Both platforms' own *current* real
webhook mechanisms (checked live, not assumed — Microsoft's legacy Office 365
Connectors are being retired in favor of the Workflows app) turned out to
accept the identical plain `{"text": "..."}"` payload shape, so one new `kind`
column on the existing `Webhook` model (`'generic' | 'slack' | 'teams'`) and one
shared formatter cover both platforms — reusing the existing delivery queue,
retry/backoff, and SSRF guard entirely unchanged, only the payload content and
whether it's HMAC-signed differ by kind. A curated 3-event subset (new ticket,
either SLA breach) avoids forwarding UUID-only or potentially-sensitive raw
event data into a possibly-public channel. See
`docs/adr/0048-chat-notifications.md`.

**Grafana Alerting integration ✅ (this pass) — one of the "one or two
monitoring tools" named integrations.** `POST /v1/alerts/grafana`
(`apps/api/src/modules/integrations/grafana.ts`) maps Grafana's own,
unmodified default webhook payload onto the existing generic
`/v1/alerts`/`ingestAlert()` mechanism (ADR 0003) — no per-tenant Grafana-
side templating required, same `ApiKey` auth as every other API channel.
One ticket per Grafana webhook call (matching Grafana's own alert
grouping); `groupKey` drives the existing re-fire/dedup logic so repeated
firing and resolved notifications for the same alert group fold into one
ticket while it's open, without auto-closing it — a human still decides
when "Grafana says this cleared" means the ticket is actually done. A
`severity` label (Grafana's own informal convention) maps onto the
existing 5-value scale; no label defaults to Normal priority, never a
guess. New "Monitoring Integrations" setup page (Administration) shows the
webhook URL with one-click copy and the exact steps, reusing the existing
API Keys page rather than duplicating key management. Zabbix is not built
in this pass -- its integration model (a tenant-authored JS payload script)
is a different shape of problem than Grafana's, deferred rather than
rushed. See `docs/adr/0039-monitoring-integrations.md`.

**Zabbix integration ✅ (this pass) -- the deferral above resolved.** Unlike
Grafana, Zabbix's webhook always runs a tenant-provided script with no fixed
default payload, so the mapping lives entirely in a ready-made script (macros,
severity scale, and script structure confirmed against Zabbix's live docs, not
guessed) that already targets the existing generic `/v1/alerts` endpoint --
zero new backend code. A second card on the same "Monitoring Integrations" page
shows the setup steps and the copyable script. Restricting to Problem events
(via a Zabbix Action condition, not an in-script status check) is a deliberate,
disclosed scope cut: which macro cleanly carries problem-vs-resolved into a
webhook's parameters isn't consistently documented, so this avoids guessing at
it. See `docs/adr/0046-zabbix-integration.md`.

Verified: 6 new integration tests (Grafana's own title/message used when
present, a synthesized fallback when it sends its default unmodified
payload, severity-label mapping, no-label default, re-fire dedup, and a
resolved notification recorded as a message rather than silently dropped).
Full `apps/api` suite 213/213 green. Verified live end-to-end against the
real running dev stack, not mocked: a real `curl`-POSTed Grafana-shaped
payload produced a real ticket with the right priority/contact, a second
resolved notification for the same group correctly folded into the same
ticket instead of creating a new one, and an invalid API key was cleanly
rejected. Frontend verified live in a browser (clipboard permissions
explicitly granted so the copy button's real behavior — not headless
Chromium's default no-op — was actually exercised).
- Advanced reporting/export (full data portability already shipped, Phase 2).

**Customer satisfaction (CSAT) surveys ✅ (this pass).** A ticket's first-ever
resolution posts a survey link as a `SYSTEM` message via the existing `addMessage` --
which is also what makes it reach the customer for free through whichever outbound
mechanism the ticket's channel already has (email/Telegram's `shouldEmail`/
`shouldTelegram`, or the widget's own polled conversation view), no new distribution
mechanism built. Public survey page at `/csat/:tenantSlug/:token`; a new
`getCsatSummary` reporting aggregate and `csat_score` dashboard widget slot into the
existing catalogs. Found and fixed a real correctness bug along the way: `addMessage`'s
SLA `firstRespondedAt` stamping used to block-list `CONTACT` rather than allow-list
`AGENT`/`AI`, which would have let this exact SYSTEM message get credited as a real
agent response. See `docs/adr/0045-csat-surveys.md`.

**First CI pipeline + automated RLS fuzz tests ✅ (this pass).** This repo
had no CI at all before this -- `.github/workflows/ci.yml` runs the exact
`infra/docker/migrate-entrypoint.sh` bootstrap (migrate deploy → RLS
policies → seed) against disposable Postgres/Redis service containers,
verified locally first against a genuinely fresh database (never done
before this pass -- every prior migration was applied incrementally onto
an already-migrated dev database) before ever being pushed: all 30
migrations applied cleanly from nothing, full `apps/api` suite 207/207
green against it. `apps/api/test/rls-fuzz.test.ts` (`fast-check`, a new
dependency) randomly exercises 18 tenant-scoped models -- every one simple
enough to build a fixture for with no FK beyond `tenantId` -- across 40
runs, confirming no cross-tenant leak on any of them; this complements
rather than replaces the existing 3 hand-written isolation suites, which
already prove RLS itself (not just the Prisma extension) blocks a leak
generically for every table via one shared policy loop -- what the fuzz
test adds is breadth against the real risk of a *new* table's
`TENANT_SCOPE_FIELD`/`policies.sql` wiring drifting or being forgotten.
**Known gap**: the actual GitHub Actions run couldn't be observed from this
sandbox (no local Actions runner); every step was verified by running its
real command locally instead. See
`docs/adr/0037-rls-fuzz-tests-and-ci.md`.

**Multi-replica audit ✅ (this pass, partial) — "WS fanout" corrected as
stale.** "WS fanout" traced back to the *original* pre-ADR-0019 plan; ADR
0019 (collision detection) explicitly chose a short-poll heartbeat instead
of WebSockets, confirmed by grep -- no `@fastify/websocket`, no websocket
plugin anywhere. There was never anything real to verify there; corrected
rather than left implying unaddressed risk. A systematic in-memory-state
audit found presence (already Redis-backed) and SLA/webhook scheduling
(already BullMQ-delay-backed, not `setTimeout`) were already multi-replica-
safe, and fixed the one real gap: `@fastify/rate-limit` defaulted to an
in-process store, silently multiplying every configured limit (including
`/auth/login`'s brute-force throttle) by however many replicas happen to be
running. Now backed by a dedicated `ioredis` connection -- verified live by
hitting `/auth/login` against the real dev API and confirming the counter
and TTL actually appear in Redis, not just in one process's memory. Full
`apps/api` suite 207/207 green. **Not done**: email-poll double-polling
under multiple worker replicas remains a known, disclosed limitation (ADR
0004) this pass didn't fix; no actual multi-replica load test was run (this
sandbox can't orchestrate multiple replicas behind a load balancer). See
`docs/adr/0038-multi-replica-hardening.md`.

## Phase 5 — Endpoint agents (Windows/Linux/macOS) ✅ done, inventory-only by design

Deeper than Phase 1's agentless discovery (a best-effort TCP+SNMP network scan
that only ever reads what's reachable from outside a device) — a real lightweight
background agent installed *on* a device: full hardware/software inventory, OS
patch level, disk-encryption/AV status. Sequenced after Phase 4 deliberately:
letting a fleet of real, privileged endpoints phone home safely is much
lower-stakes once the multi-tenant cloud hardening above already exists, than
bolting it onto an earlier phase.

**Tier 1 (inventory-only) ✅ (this pass) — and, per the user's explicit call,
the intended permanent shape of this feature, not a stepping stone.** `apps/agent`,
a real Node.js reference agent (zero dependencies, no build step, unsigned —
researched and confirmed this is the real pattern GLPI-Agent itself uses, not a
shortcut) reports hardware/software inventory, OS version, disk encryption, and
antivirus status from a genuinely real device. Per-device enrollment via a
short-lived, single-use token minting a permanent per-device credential (same
exact-match-hash shape as `ApiKey`) — a single compromised device can be revoked
without touching any other device. New `Device`/`DeviceEnrollmentToken` models plus
new inventory columns directly on the existing `Asset` model (a new
`discoverySource: 'AGENT'` value, following the same source-specific-nullable-
column shape agentless discovery's `snmpSysDescr` already established). See
`docs/adr/0047-endpoint-agents-v1.md`.

**Remote execution/deployment (tiers 2/3) and a signed installer are deliberately
NOT planned, not just "not yet built."** Both carry real, ongoing costs an
unfunded open-source project has no way to absorb responsibly: a code-signing
certificate (Windows OV/EV, ~$70-400/year, business identity verification) and an
Apple Developer Program membership (~$99/year) are recurring expenses with no
revenue behind them; remote script/software execution on a customer's real machine
is also the single biggest security/liability surface in this whole codebase,
demanding an ongoing audit/maintenance commitment no solo maintainer can
responsibly staff. The unsigned Node.js script, downloaded and run directly, IS the
long-term answer for this project, not a placeholder for something fancier later —
matches how plenty of real open-source infrastructure ships (most CLI tools and
many agents are distributed exactly this way, checksummed rather than
code-signed). Revisit only if a funded fork, a sponsor, or a paid hosted-cloud
tier one day makes the ongoing cost/liability sustainable — not speculatively.

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

**Console internationalization (i18n) — 🚧 v1/v1.1 shipped 2026-09-21, partial
coverage (ADR 0049).** The admin console was English-only; real value for a
self-hosted, open-source tool whose adopter base skews international (unlike a
hosted SaaS with one default locale, a self-hosted operator's own staff and
customers may not read English at all). Shipped: `react-i18next`, a per-user
(not per-tenant) language preference persisted in `localStorage`, a real second
locale (Spanish, not just scaffolding) covering Login/Register/the shared
`AuthLayout`, the sidebar navigation (all groups and item labels), the Dashboard
(title, all 7 widget labels, every widget's empty-state copy), and — same day,
v1.1 — **Tickets Queue and Ticket Detail**, the two largest and highest-traffic
screens in the console (tabs, search, filters, saved views, bulk-edit bar, the
ticket table, both new-ticket forms, the message composer, escalation/merge/AI
controls, the Details sidebar). Tenant-configured data (ticket status labels,
custom field labels, macro/team/service names, and the priority enum values
themselves) is deliberately left untranslated throughout — it isn't frontend
copy, it can't live in a static locale file. The file format (one JSON per
locale, namespaced by feature) lets a community contributor add a language by
editing one file, no build tooling or paid localization vendor required —
deliberately a cost-free way to grow, unlike the OAuth-app/code-signing items
above. **Not yet covered, named explicitly rather than silently incomplete**:
every other page under CMDB/Configuration/Operations/Administration (~49
files); the dashboard's onboarding-checklist item text is backend-supplied and
needs a locale-aware API response, not just a frontend string sweep.

**AI-assisted initial setup, added 2026-09-21.** Phase 2's first-run product tour
(✅, `getOnboardingChecklist`) is a static checklist — customize a status, set an
SLA policy, create a macro, invite a teammate. This item asks whether Seredina's
own AI copilot (Phase 3, already answering questions grounded in a tenant's real
data) could instead *do* some of that setup conversationally — e.g. a new admin
describes their team's workflow in plain language and the AI proposes concrete
ticket statuses/SLA policies/macros for them to review and accept, rather than
clicking through each settings page cold. Not scoped yet: how much should be
AI-proposed vs. human-configured, whether this reuses the existing `AiAgentRun`
approval-gate shape (Phase 3) for "AI-proposed config, human approves" the same
way a mutating tool call already works, and whether it's worth the added AI-cost-
per-signup for a self-hosted operator who may have no AI provider configured at
all (Phase 4's BYOK is opt-in, not guaranteed set up before first use).

**Other**: mobile apps, voice/telephony, BPMN-style workflow automation, SSO/SAML,
per-tenant data residency.

**Extensibility, decided 2026-09-16: integrations, not a plugin platform —
in either deployment mode.** A self-hosted-only native plugin loader was
considered and explicitly rejected, not just left un-prioritized: the user's
own call was that a curated, growing list of pre-built integrations (Slack,
Teams, a specific ticketing/monitoring tool, ...) a tenant enables and
configures through Settings ships more real, usable feature surface than a
generic loader ever would, without ever needing a plugin permission/
capability model at all. Every one of these is still built on the same
contract-based foundation already in place — the existing `Webhook`/`ApiKey`
mechanisms (Phase 2 ✅) for outbound, Phase 3's MCP server for AI-era
integrations — just packaged as a one-click "Connect Slack" in the product
instead of a tenant hand-rolling their own webhook receiver. No third-party
or tenant-supplied code runs inside Seredina's process, in cloud or
self-hosted, full stop.

## Key risks (carried forward from planning, revisit each phase)

- RLS+Prisma pooling correctness is the single biggest technical risk in this whole
  system — mitigated in Phase 0, but any new tenant-scoped model added in later
  phases must get both an RLS policy AND a `TENANT_SCOPE_FIELD` entry, or it silently
  runs unscoped.
- Never call slow external I/O (LLM completions, SMTP sends) inside `withTenantTx` —
  it holds a pooled connection open for the duration and will starve the pool.
- AGPLv3: audit new dependencies for license compatibility. Contributor policy
  decided 2026-09-21: DCO sign-off (`DCO.md`, CI-enforced via
  `.github/workflows/dco.yml`), not a full CLA — there's no dual-licensing/
  enterprise-fork plan this project would need to re-license for later.
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
- ~~Multiple `worker` replicas would double-poll every tenant's email channels~~ —
  resolved: per-mailbox Redis lock plus Message-ID-idempotent ingestion, see
  `docs/adr/0057-email-poll-lock.md`.
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
