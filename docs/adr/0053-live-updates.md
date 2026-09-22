# ADR 0053: Live console updates

## Status

Accepted, implemented.

## Context

Nothing in the console updated on its own. The notification bell polled every
20 s; the ticket detail page polled only for presence (every 8 s), never for
the ticket itself, so a customer's reply did not appear until the agent
reloaded; the ticket queue never refreshed. For a helpdesk, where the job is
reacting to what just came in, that is the most visible gap left.

## Decision

### Transport: Server-Sent Events, not WebSockets

Every update flows server → browser; the browser already talks back over the
REST API. SSE is plain HTTP (works through the existing CORS, auth and rate
limiting, and through ordinary reverse proxies), and reconnect is trivial.
WebSockets would add a second protocol for a two-way channel nothing needs yet.

`GET /events` (`apps/api/src/modules/live/routes.ts`), gated on
`tickets:read`. The web app reads it with `fetch()` and parses the stream
itself (`apps/web/src/lib/live.ts`) instead of using `EventSource`, because
`EventSource` can't send an `Authorization` header — the alternative, a token
in the URL, would land in proxy and access logs.

### Fan-out: Redis pub/sub

`api` runs as several replicas (ADR 0038) and `worker` makes changes too
(inbound email, SLA breaches, escalations), so an in-process emitter would
miss most events. Publishers `PUBLISH` to `seredina:live:{tenantId}`; each API
process holds **one** subscriber connection (`PSUBSCRIBE seredina:live:*`) and
fans out in memory to its open streams — not one Redis connection per tab.
The tenant is taken from the channel name, so an event can only ever reach
streams of the tenant it was published for.

### Events are invalidations, not data

An event is `{ type, ticketId }` (or `{ type: 'notification.created', userId }`)
and nothing else: never a subject, a message body, or an assignee. The
console refetches through the normal REST API, which applies the viewer's
permissions. So the stream can't leak what the viewer couldn't already read,
and it needs no permission logic of its own beyond `tickets:read` to connect.
`parseLiveEvent` (`packages/shared/src/liveEvents.ts`) re-validates every
message off Redis and keeps only the type and its id, so even a buggy
publisher can't push extra fields through. `notification.created` goes only to
that user's own streams.

Types: `ticket.created`, `ticket.updated`, `message.created`, `sla.breached`,
`notification.created`. The API publishes from `dispatchWebhookEvent` — every
ticket/message change already calls it after its commit — plus internal notes,
which webhooks deliberately skip but colleagues should see appear.

### A stream outlives the check that opened it

`authenticate()` runs once, at connect. So the stream also:

- re-checks the user every 60 s and closes if they were deactivated, deleted,
  or lost `tickets:read`;
- closes when the JWT expires;
- is capped at 5 per user (the oldest is closed), so one user can't hold an
  unbounded number of sockets;
- sends a heartbeat every 25 s so proxies don't drop it as idle, with
  `X-Accel-Buffering: no` for nginx.

### Best-effort, never load-bearing

Publishing never throws (a Redis hiccup must not fail the request that made
the change), and the data is already committed either way. After a
reconnect the client emits a local `resync` and every view refetches, so
events missed while offline don't matter. If the stream can't connect at all,
the bell falls back to its old polling. Redis down at connect answers 503.

### What the console does with events

- **Queue**: collects events for 400 ms, then refetches what's on screen once
  (an alert storm is one request), and briefly highlights rows that changed or
  appeared. A Live / Reconnecting indicator sits next to the title.
- **Ticket detail**: refetches when an event names its ticket.
- **Bell**: refreshes its count on `notification.created`; polls only while
  the stream is down.

## Not done yet

Typing indicators and the SLA countdown build on this but are separate
changes. Presence ("who has this ticket open") still uses its existing
heartbeat.

## Verified

9 integration tests (`apps/api/test/live-events.test.ts`, real HTTP listener,
real Redis and Postgres): auth required; CORS headers survive hijacking; a real
ticket and a private note arrive as ids only, with the subject and note text
absent from the stream; no cross-tenant delivery; notifications only to their
user; malformed/unknown/extra-field messages dropped; stream closes on
deactivation and on losing `tickets:read`; per-user cap closes the oldest.
Plus unit tests for `parseLiveEvent` and `publishLiveEvent`.

Live in Chromium against the running API and web app: with the queue open,
a ticket created by another agent appeared and was highlighted without a
reload; on the ticket page, a colleague's internal note appeared on its own;
assigning a ticket to the viewer lit up the bell.
