# ADR 0033: Shared AI tool catalog, AutonomyPolicy, AiAgentRun audit trail, MCP server (stdio)

## Status

Accepted, implemented. HTTP/SSE transport explicitly deferred (see Consequences).

## Context

Phase 3's remaining named items after RAG (ADR 0032) were: a shared AI tool
catalog, an `AutonomyPolicy` engine with an `AiAgentRun` audit trail, and
`apps/mcp-server` — the "open framework" requirement so a tenant's *own*
external agent (Claude Desktop, an n8n workflow, a custom script) can act on
tickets under the same guardrails as Seredina's built-in copilot, not a
separate, unaudited path.

The original architecture plan called `apps/mcp-server` "a thin wrapper over
api's service layer" — a design choice made before `apps/worker`'s later,
deliberate rule (ADR 0020/0022) that `apps/worker` never imports `apps/api`
code. Those are different situations: the worker/api split exists because
they're independently scaled, always-running deployables that shouldn't share
runtime coupling. `apps/mcp-server` is neither of those — it's a short-lived,
per-session process a client spawns on demand, and the entire point of the
"shared tool catalog" requirement is that copilot, autonomous mode, and MCP
all call *the same* implementation of `get_ticket`/`add_ticket_reply`/etc.
The tickets/macros service-layer functions those tools wrap already live in
`apps/api/src/modules/*`, own the webhook dispatch, SLA stamping, and Redis
queue wiring those actions need, and moving them to a shared package would
mean also moving `apps/api/src/lib/queue.ts`, `webhookDispatch.ts`, and
several other modules — a much larger refactor not justified by this feature.
So `apps/mcp-server` imports `apps/api/src/modules/ai-tools/*` directly, by
relative path — a deliberate architectural choice, not the same kind of
worker/api coupling ADR 0020 ruled out.

## Decisions

**One tool catalog, six tools, in `apps/api/src/modules/ai-tools/catalog.ts`.**
`get_ticket` (read-only), `add_ticket_reply`, `set_ticket_status`,
`assign_ticket`, `apply_macro`, `escalate_to_human` — every `execute` is a
thin wrapper over the exact service-layer function a human agent's own UI
action already calls, so an AI-driven action gets webhook dispatch, SLA
milestone stamping, and notification emails for free and can never drift from
what a human clicking through the console would get. Each tool's `argsSchema`
is a zod `ZodObject` (not the more general `ZodType`) specifically so
`apps/mcp-server` can pull out its raw shape (`argsSchema.shape`) for MCP tool
registration, which only a `ZodObject` exposes.

**`set_ticket_status` takes a status *key* ("resolved"), not a raw id.** A
model calling this tool from conversation context is far more likely to
reason in terms of "resolved" than a UUID it has no way to already know;
`get_ticket` (already callable) is how it would learn what a ticket's current
status key is if unsure.

**`escalate_to_human` reuses only existing primitives** — an internal note
explaining why, plus clearing the assignee so the ticket surfaces in the
unassigned queue — rather than inventing a new "needs attention" flag or
webhook event. Minimal and real, not speculative.

**`MessageAuthorType.AI`, unused since the schema was first written, is now
actually used.** `AddMessageInput.authorUserId` became optional
(`authorType` defaults to `'AGENT'`, in which case `authorUserId` is still
required — enforced at the top of `addMessage`, not just by the type system)
so an AI-authored reply speaks for the tenant's AI agent as a whole, not a
fabricated human user row. `applyMacro` gained the same optional
`authorType` parameter for the same reason (its own `addReply` action calls
`addMessage`) — both changes are backward compatible; every existing call
site still passes `authorUserId` positionally and gets `authorType: 'AGENT'`
by default.

**`AutonomyPolicy`: one row per tenant (same "no row = default" shape as
`BusinessHours`/escalation tiers), the safest possible default.** No row
means `autoExecuteTools: []` — nothing auto-executes — and a 20-actions/day
cap. `updateAutonomyPolicy` rejects any name not in the catalog's *mutating*
tools specifically: listing a read-only tool like `get_ticket` here would be
meaningless (it never touches the gate at all — see below), so it's rejected
up front rather than silently accepted and ignored.

**`AiAgentRun`: one row per tool invocation, both the audit trail and the
approval queue.** A single model with a `status` (`PENDING_APPROVAL` /
`EXECUTED` / `REJECTED` / `FAILED`), not two separate models for "pending
suggestion" vs. "audit log" — simpler, and a `PENDING_APPROVAL` row *is*
already the audit record for that action once a human acts on it, not a
different thing. `args`/`result` are stored as plain JSON, deliberately not
redacted: every tool is a thin wrapper over the same service layer a normal
API response already exposes, so there's no secret column here a tool could
leak that a human agent's own UI couldn't already see.

**The executor (`executor.ts`'s `runTool`) is the single gate every AI actor
goes through** — never a tool's own `execute` directly. Read-only tools skip
the gate entirely (no `AiAgentRun` row, no policy check) since there's no
side effect to audit. A mutating tool either runs immediately (on the
allow-list, under the daily cap) and logs `EXECUTED`, or is recorded
`PENDING_APPROVAL` without executing. **Approval bypasses the allow-list
check but not the tool's own `argsSchema`/`execute`** — `approveAiAgentRun`
re-validates the stored args against the tool's current schema before
running it for real, cheap insurance against schema drift between when a run
was queued and when a human gets around to reviewing it.

**`apps/mcp-server`, stdio transport only (this pass).** One process = one
client = one tenant: the tenant is resolved from a `SEREDINA_API_KEY` env var
via the *same* `resolveTenantIdByApiKeyHash` function apps/api's own
`ApiKey` auth plugin uses (moved to `@seredina/db` from
`modules/tenants/service.ts` specifically so both consumers share one
implementation — along with `sha256Hex`, moved to `@seredina/shared` from a
one-off `apps/api/src/lib/hash.ts`), once at startup, and closed over by
every registered tool handler for the life of the process. `tenantId` is
never a tool input argument — a connected agent has no way to ask for
another tenant's data even if it tried. No `AsyncLocalStorage` is needed for
this transport specifically: there is exactly one session per process, so a
plain closed-over variable is equivalent and simpler. (See Consequences for
why HTTP/SSE, which genuinely would need per-request `AsyncLocalStorage`
session binding for concurrent multi-tenant sessions, is deferred rather than
built speculatively now.)

**Two small, mechanical fixes the MCP SDK forced, neither a design choice:**
- The `@modelcontextprotocol/sdk`'s deep subpaths
  (`@modelcontextprotocol/sdk/server/mcp.js`,
  `.../server/stdio.js`) exist only via the package's `exports` map, not as
  literal files — this repo's shared `moduleResolution: "node"` (classic,
  `exports`-blind) can't see them at all, confirmed by trying and getting a
  hard "no such file" both from `tsc` and by checking the literal path on
  disk. `apps/mcp-server/tsconfig.json` overrides to `module`/
  `moduleResolution: "node16"` — the pairing TypeScript requires together,
  which understands `exports` and still emits CommonJS for a package with no
  `"type": "module"` (confirmed: `tsc -p tsconfig.json` produces
  `dist/mcp-server/src/index.js` as plain `require()`-based CommonJS, same as
  `apps/api`/`apps/worker`'s own build output) — a resolution-only change,
  not a switch to ESM output.
- The SDK's peer dependency is `zod: "^3.25 || ^4.0"`; this repo's `zod` was
  pinned to `^3.23.8` everywhere. Bumped `apps/api` and `apps/mcp-server` to
  `^3.25.0` — a same-major (v3) patch-range bump, not the v3→v4 migration
  this codebase's ~30 existing zod schemas across every route file are
  nowhere near ready for. Full `apps/api` suite re-run clean after the bump
  (178/178), confirming nothing in the existing zod usage broke.

**`apps/mcp-server`'s cross-app import needed its own `tsconfig.json`
`include`.** Listing the whole `../api/src/modules/ai-tools` directory would
have dragged `routes.ts` into this program too — it depends on this
project's own Fastify `FastifyRequest`/`FastifyInstance` type augmentations
declared elsewhere in `apps/api`, which this program never includes.
TypeScript always follows a file's actual imports regardless of `include`, so
listing only `["src"]` was sufficient: `index.ts` imports `catalog.ts` and
`executor.ts` (which pull in `policy.ts`/`agentRuns.ts`), never `routes.ts`.

**Frontend: "AI Agent Activity" under Operations** (`apps/web/src/pages/AiAgentActivity.tsx`) —
checkboxes per mutating tool (rendered from `GET /ai-tools/catalog`, not
hardcoded, so the frontend never drifts from the real catalog), a max-actions-
per-day input, and an activity log with Approve/Reject buttons for pending
runs, filterable by status. Same `tickets:manage_all` permission tier as
webhooks/macros/escalation-tier configuration — this is tenant-wide AI-
behavior oversight, not a day-to-day ticket action.

## Consequences

- **HTTP/SSE transport is not built.** Named in the original roadmap
  alongside stdio, but stdio alone already delivers the real value (a local
  MCP client like Claude Desktop) and a second transport with genuine
  multi-tenant concurrent sessions is a meaningfully bigger scope: it would
  need the `AsyncLocalStorage` session-binding this ADR's stdio design
  deliberately doesn't need yet, session lifecycle/auth over HTTP, and its
  own verification story. Deferred, not silently dropped — the stdio design
  above was written so adding HTTP/SSE later doesn't require re-architecting
  the tool catalog, policy, or audit trail, only the transport and session
  layer around them.
- **`apps/mcp-server` has no automated Docker build verification.** A
  `docker build -f infra/docker/Dockerfile.mcp-server` attempt in this
  sandbox hit the same slow/uncached-layer-pull timeout this session has hit
  before (see ADR 0031) — inconclusive, not a pass, and not claimed as one.
  The Dockerfile follows the same multi-stage pattern as `Dockerfile.worker`,
  adjusted to also copy `apps/api` (needed for the cross-app import).
- **No `docker-compose` service for `apps/mcp-server`.** Deliberate, not an
  oversight: a stdio-transport server is meant to be spawned on demand by an
  MCP client that owns its stdin/stdout directly (`docker run -i`), not run
  as an always-on background container the way `api`/`worker`/`web` are —
  adding a compose service would misrepresent how it's actually used.
- **The daily auto-execute cap is per-tenant, not per-run.** There is no
  multi-turn autonomous agent loop yet (that's a separate, larger future
  piece — an actual `adapter.complete()` tool-use loop deciding which tools
  to call) to define a "run" boundary; "actions executed across this tenant
  today" is the only well-defined boundary that exists right now.
- **`escalate_to_human`'s unassign-based design has no dedicated "needs
  attention" signal beyond the existing unassigned-ticket queue.** Real and
  useful today; a future iteration could add a stronger signal (a
  notification to on-call staff, a dashboard widget) without changing the
  tool's contract.

## Verified

**Unit/integration tests** (`apps/api/test/ai-tools.test.ts`, live Postgres,
skipped without `DATABASE_URL` per this codebase's standing convention),
14 passing: a fresh tenant's default policy is the safe empty allow-list;
`get_ticket` always executes immediately with zero `AiAgentRun` rows created;
a mutating tool not on the allow-list becomes `PENDING_APPROVAL` and does
**not** execute (verified by checking the ticket's actual messages, not just
the return value); approving a pending run executes it for real, authored as
`AI`; rejecting one never executes it; a tool added to the allow-list
auto-executes and logs `EXECUTED`; the daily action cap forces a
second allowed call back to `PENDING_APPROVAL` once the cap is hit;
`updateAutonomyPolicy` rejects an unknown tool name *and* a real-but-
read-only one (`get_ticket`); `set_ticket_status` resolves a human-readable
key and rejects an unknown one; `escalate_to_human` posts a private note and
clears the assignee; `apply_macro` invoked through the catalog runs its
`addReply` action authored as `AI`; an unknown tool name and schema-invalid
arguments both throw clean errors; approving/rejecting an already-resolved
run, or a nonexistent one, is rejected with a clear message. Full `apps/api`
suite re-run after adding these: 178/178 passing (9 skipped, unrelated), and
`apps/api`/`apps/web`/`apps/worker`/`apps/mcp-server` all typecheck clean.

**The MCP wire protocol was verified end-to-end with a real client and a
real server process, not a mock or a direct function call.** Registered a
tenant and an API key through the actual running dev API, created a real
ticket, then used the MCP SDK's own `Client` + `StdioClientTransport` to
spawn the actual `apps/mcp-server` (via `tsx`, exactly as `npm run dev`
would) as a genuine child process and speak real JSON-RPC to it over stdio:
`tools/list` returned all six real tools; `get_ticket` executed immediately
and returned the ticket's real subject; `add_ticket_reply` correctly came
back `pending_approval` (the default policy) with a real run id; calling an
unregistered tool name and calling a real tool with an invalid (non-UUID)
`ticketId` were both cleanly rejected by the SDK's own protocol-level
handling (`isError: true`, a specific message), not a crash. Then, back
through the real HTTP API (not the MCP client): `GET /ai-agent-runs` showed
the pending run with correct ticket/tool/args; `POST
/ai-agent-runs/:id/approve` executed it for real; re-fetching the ticket
confirmed the reply actually posted, `authorType: "AI"`. This proves the
full loop — MCP client → MCP server → shared tool catalog → AutonomyPolicy
gate → AiAgentRun audit row → human approval via the real REST API → real
mutation — end to end, not any one piece in isolation.

**Frontend verified live in a browser** (Playwright, real dev stack, no
mocks): registered a tenant, navigated to AI Agent Activity, confirmed all
five mutating tools render as checkboxes (sourced from the live
`/ai-tools/catalog` response) and the empty-activity-log state renders
correctly; toggled a tool's checkbox on, confirmed the change survives a full
page reload (proving the round-trip to `PATCH /autonomy-policy` and back);
changed the max-actions-per-day input and confirmed it also persists across
reload; zero browser console errors throughout. (One transient
Playwright-specific false alarm along the way: its `.check()` assertion
sampled the checkbox mid-way through React's controlled-input re-render
cycle and reported "did not change state" even though a plain click + a
short wait immediately after showed the correct final state — a test-tooling
timing artifact, not an application bug, confirmed by re-running with a
looser wait.)
