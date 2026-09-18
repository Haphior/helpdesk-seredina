# ADR 0038: Multi-replica audit — the rate limiter, and correcting a stale roadmap claim

## Status

Accepted, implemented.

## Context

The last Phase 4 item within reach without an external account/pricing
decision: "verified stateless multi-replica `api`/`worker` + WS fanout under
load." This sandbox cannot actually run multiple replicas behind a load
balancer or generate real load — no Kubernetes, no multi-container
orchestration (this session has hit that limitation before, see ADR 0031).
What this pass *could* do, and did: a systematic code audit for in-memory
state that would silently misbehave the moment `api`/`worker` run as more
than one process, fixing what was found to be real and correcting what
turned out to be a stale claim from the project's very original planning
document.

## Findings

**"WS fanout" was never real.** The phrase traces back to this project's
original architecture plan (before ADR 0019 existed), which anticipated
realtime updates over WebSockets with Redis pub/sub for fanout across
replicas. ADR 0019 (collision detection) explicitly chose a short-poll
heartbeat instead — confirmed by grepping the actual codebase: no
`@fastify/websocket` dependency, no `plugins/websocket.ts`, and the only
two matches for "WebSocket" in the entire source tree are code comments
*explaining why it's deliberately not used*. There has never been anything
to verify here; the roadmap bullet was carrying forward planning language
that a later, real decision (ADR 0019) had already superseded. Corrected in
`docs/ROADMAP.md` rather than silently left to imply unverified risk.

**Presence (`apps/api/src/lib/presence.ts`) was already correct.** It's
Redis-backed (`SET ... EX` / `SCAN`) from the day ADR 0019 shipped it —
already safe across replicas, nothing to fix.

**SLA breach checks and webhook retries were already correct.** Both use
BullMQ's own `delay`/`backoff` options (Redis-backed delayed jobs any worker
replica can pick up), not an in-memory `setTimeout` — confirmed by reading
`sla/service.ts`'s `scheduleSlaBreachChecks` and `lib/webhookDispatch.ts`
directly, not assumed.

**Email polling double-polls under multiple worker replicas — already
known and disclosed, not a new finding.** `apps/worker/src/index.ts`'s own
comment already states this plainly (see ADR 0004): a plain interval loop
across every tenant's channels, one per worker process, with no
distributed lock. Re-confirmed still accurate; not changed in this pass —
fixing it (a distributed lock, or converting to a BullMQ repeatable job with
per-channel exclusivity) is real, separate work with its own design
tradeoffs, not a quick fix bundled into an audit pass.

**The Fastify rate limiter was genuinely broken for multi-replica —
the one real, fixable finding.** `@fastify/rate-limit` defaults to an
in-process `Map` (`LocalStore`) when no shared store is configured. Under N
replicas behind a load balancer, each replica counts requests
independently, so the *effective* limit becomes the configured value times
however many replicas happen to be running — silently weakening exactly the
limits that matter most under real scale, like `/auth/login`'s 10/min
brute-force throttle.

## Decision

**A dedicated `ioredis` connection for the rate limiter**
(`apps/api/src/lib/rateLimitRedis.ts`), passed via `@fastify/rate-limit`'s
`redis` option. Confirmed by reading the plugin's own `RedisStore.js`
source (not assumed from its `redis?: any`-typed option) that it calls
`this.redis.defineCommand(...)` to register its rate-limiting Lua scripts —
`defineCommand` is specifically an `ioredis` API, not the plain `redis`
npm package, confirming this project's existing `ioredis` dependency
(already used identically in `lib/queue.ts` and `lib/presence.ts`) is
exactly the right client, not a guess.

**A separate connection, not a shared import of `lib/queue.ts`'s own
client.** That client is configured with `maxRetriesPerRequest: null`
specifically because BullMQ requires it — a genuine constraint of BullMQ's
own retry semantics, not a general default. The rate limiter has no such
requirement and is better served by `ioredis`'s own default (bounded)
retry behavior, so coupling its connection lifecycle to the queues' would
have imported an unrelated constraint for no reason.

**Per-route rate limits (`/auth/register`, `/auth/login`) needed no
individual change** — confirmed by reading `@fastify/rate-limit`'s own
source: a per-route config derives a *child* store from the global plugin
instance's store (`pluginComponent.store.child(...)`), so once the global
registration uses the Redis-backed store, every per-route limit inherits
it automatically with its own namespaced counter.

## Consequences

- **Email-poll double-polling under multiple worker replicas remains
  unfixed** — a real, disclosed limitation carried forward from ADR 0004,
  not resolved by this pass. A future fix would need a distributed lock
  (e.g., a Redis `SET NX` per channel) or moving polling into a BullMQ
  repeatable job.
- **No real multi-replica load test was run** — this sandbox has no way to
  actually run more than one `api`/`worker` process behind a load balancer
  and generate concurrent load against them. What's verified is the
  specific in-memory-state risk this audit found and fixed, confirmed live
  against a real Redis instance; it is not equivalent to an actual
  multi-replica load test.
- **`docs/ROADMAP.md`'s Phase 4 bullet is corrected** to describe what was
  actually audited/fixed (in-memory state, specifically the rate limiter)
  rather than repeating the stale "WS fanout" framing.

## Verified

**Live, against a real Redis instance, not just typechecked**: hit
`POST /auth/login` three times against the real running dev API, then
inspected Redis directly — `GET fastify-rate-limit-POST/auth/login-127.0.0.1`
returned `3` (matching the three real requests) with a `TTL` of 51 seconds
remaining (matching the configured 1-minute window). Before this fix, no
such key would ever appear in Redis at all — the counter lived only in that
one process's own memory. Full `apps/api` suite re-run after the change:
207/207 passing (9 skipped, unrelated), confirming the swap didn't disturb
any existing rate-limited route's behavior. Typechecks clean.

**Codebase audit, not assumption**: every claim above (presence's Redis
backing, SLA/webhook using BullMQ delays not `setTimeout`, the absence of
any WebSocket dependency or plugin, the email-poll loop's own
already-documented limitation) was confirmed by reading the actual source
files directly, not recalled or inferred from prior session context.
