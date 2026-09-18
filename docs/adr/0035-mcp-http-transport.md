# ADR 0035: MCP server Streamable HTTP transport

## Status

Accepted, implemented.

## Context

ADR 0033 shipped `apps/mcp-server` with stdio only, deferring HTTP/SSE as a
meaningfully bigger scope (real session concurrency, a second transport, its
own verification story) than that pass justified. This closes that gap.

## Decisions

**Streamable HTTP, not the older separate SSE transport.** The MCP SDK's
current transport is `StreamableHTTPServerTransport` — one endpoint
(`POST /mcp`) that supports both plain HTTP responses and SSE streaming as
needed, superseding the two-endpoint (POST + a separate `GET` SSE stream)
design "HTTP/SSE" originally referred to. Building the newer, SDK-recommended
transport is truer to the roadmap's intent than reproducing a shape the SDK
itself has moved past.

**Stateless, not session-sticky.** The SDK explicitly supports both modes
(`sessionIdGenerator: () => randomUUID()` for stateful, `undefined` for
stateless). Stateful mode keeps session/connection state in memory on
whichever single server process happened to handle the client's first
request — the wrong shape for a service meant to eventually run behind a
load balancer with multiple replicas, and inconsistent with how every other
part of this codebase already treats tenant scoping as something to
re-establish on every request, never cache (RLS and the Prisma Client
Extension both re-check on every query; nothing about tenant scope is ever
memoized across requests). Stateless mode means: a fresh `McpServer` +
`StreamableHTTPServerTransport` per HTTP request, and the tenant resolved
fresh from that request's own `Authorization: Bearer <ApiKey>` header every
time — one extra RLS-backed lookup per request, negligible next to what it
avoids (session-cleanup bugs, memory growth, replica-affinity requirements).

**Tool registration extracted into a shared `createMcpServer(tenantId)`**
(`apps/mcp-server/src/server.ts`), used by both transports. stdio
(`src/stdio.ts`) resolves its one tenant once at process startup and calls
it once; http (`src/http.ts`) calls it fresh per request. Same reasoning as
ADR 0033's `runTool()` being the one gate every caller goes through — one
implementation of "what tools exist and what they do," not two transports
each building their own catalog wiring.

**`MCP_TRANSPORT` env var (`stdio` default, or `http`)** dispatches between
them in `index.ts` — `stdio`'s existing behavior is completely unchanged
(same env var, same resolve-once-at-startup design), so no existing
deployment or MCP client config using this app needs to change anything.

**No `AsyncLocalStorage`, even for the concurrent-multi-tenant HTTP case.**
The original plan anticipated needing it once one process serves multiple
tenant sessions concurrently, but with a fresh `McpServer` instance built
per request (closing over that request's own resolved `tenantId` in each
tool handler's closure, exactly like stdio does per-process), there's no
shared mutable state between concurrent requests that needs isolating —
each request's tool handlers only ever see the `tenantId` baked into their
own closure. `AsyncLocalStorage` would only earn its complexity if handlers
needed to read an ambient "current tenant" without it being passed
explicitly; here it's already an explicit, per-request-scoped value.

**A new profile-gated `mcp-server-http` service in `docker-compose.yml`**
(`profiles: ['mcp']`) — unlike stdio (which a compose service can't
meaningfully represent: nothing is there to own the container's stdin/stdout
over the network), HTTP is a genuine always-on service, so it fits this file.
Gated behind a profile specifically so a plain `docker compose up` — the
documented default self-hosted install path — never starts it; an operator
who wants to expose it runs `docker compose --profile mcp up mcp-server-http`
explicitly.

## Consequences

- **Re-resolving the tenant on every single HTTP request** is a real,
  accepted cost of statelessness — one extra indexed lookup via the existing
  `resolve_tenant_id_by_api_key_hash` SECURITY DEFINER function, not
  expected to be meaningful next to the actual tool execution work each
  request does.
- **A client must re-authenticate every request** (send its API key every
  time) rather than authenticating once per session — acceptable for this
  server's tool-calling use case (each MCP `tools/call` is already a
  discrete request a client's own HTTP client library handles uniformly),
  unlike a browser session where re-auth-per-request would be user-hostile.
- **No automated test suite for `apps/mcp-server`, including this
  transport** — consistent with ADR 0033's own stdio transport, which also
  shipped with no automated test, relying instead on real verification
  against a genuinely running server and a real MCP client. Adding proper
  test infrastructure for this app (a devDependency on the MCP SDK inside
  `apps/api`'s test project, or standing up a dedicated test project for
  `apps/mcp-server`) was judged not worth it for a second transport when the
  first one already set this precedent; both transports' real behavior is
  documented here and in ADR 0033 instead.

## Verified

**Real, live, end-to-end — not mocked, not a direct function call.** Started
the actual `apps/mcp-server` process with `MCP_TRANSPORT=http` against the
real running dev API/Postgres/Redis stack, registered a real tenant and API
key through the real HTTP API, created a real ticket, then used the MCP
SDK's own `Client` + `StreamableHTTPClientTransport` (a real client, not a
hand-rolled HTTP request) to:

- Connect and call `tools/list` — all six real tools returned.
- Call `get_ticket` — executed immediately, returned the ticket's real
  subject.
- Open a **second, fully independent** client connection and call
  `get_ticket` again — succeeded identically, proving the "stateless" design
  claim for real: nothing about the first connection was required for the
  second to work, no shared session state leaked or was needed between them.
- Connect with an invalid API key — cleanly rejected
  (`401`/`-32001 Unauthorized`, a clear message), never silently falling
  back to some default tenant or a confusing generic error.

`GET /health` on the same server returns `{"status":"ok"}`, confirmed
directly. `docker-compose.yml` re-verified as valid YAML after the new
profile-gated service was added.
