# ADR 0019: Collision detection, ticket merge, and bulk actions

## Status

Accepted, implemented.

## Context

From the competitive pass: the three items that showed up as "must-have" in
essentially every source checked (Jira SM, GLPI, ManageEngine ServiceDesk
Plus), and flagged as "the cheapest of everything in this addition" because
each one reuses a mechanism this codebase already has, rather than needing a
new one.

## Decisions

**Collision detection is a Redis short-poll heartbeat, not a WebSocket.**
The roadmap note explicitly left both options open ("WebSocket or
short-poll"). No WebSocket infrastructure exists anywhere in this codebase
yet — building one (a Fastify plugin, connection lifecycle, a Redis pub/sub
relay for the eventual multi-replica cloud deployment) would have been a
much bigger lift than this feature's own "cheapest of everything" framing
promised. A plain Redis key per `(tenant, ticket, user)` with a 20-second TTL,
refreshed by an 8-second heartbeat from the ticket detail page, needs none of
that: `SCAN` (never `KEYS`) enumerates current viewers, safe under
production load even though the real key count per ticket is always tiny.
No delivery guarantee, and none needed — "who else has this open" is a
UI nudge, not a correctness-critical signal; worst case, a viewer who just
closed the tab still shows as present for a few more seconds.

**Presence returns userIds only, not names** — the frontend already has a
`/users` list loaded for the assignee picker, so resolving a name from a
userId is a local lookup, not a second round-trip or duplicated data. Kept
`markPresence`/`listPresence` in their own `lib/presence.ts`, mirroring
`lib/queue.ts`'s exact `lazyConnect` pattern for the same reason: importing
this module must never force every test file that merely imports
`modules/tickets/routes.ts` to need a live Redis just to load.

**Ticket merge reuses `ingestAlert`'s re-fire-folding mechanism** — move the
source's messages onto the target, add a system note, no new pattern
invented. `Ticket.mergedIntoId` (a self-relation, `SetNull` like every other
optional self-relation FK in this schema) wasn't spelled out by name in the
roadmap note, but is the one addition beyond "fold messages and close":
without it, a merged ticket is just an ordinarily-closed ticket with no
trace of where its content went — undermining the entire point of merging
rather than just closing as a duplicate. Order matters inside the
transaction: messages move to the target *first*, so the "merged into #X"
system note added to the source afterward is the one message left there —
exactly what anyone opening the old ticket URL needs to see. Rejects merging
a ticket into itself, re-merging an already-merged ticket, or merging into a
ticket that's itself been merged elsewhere (chained merges aren't modeled;
merge into the final target directly).

**Bulk actions are UI over the existing single-ticket `updateTicket`, not a
new bulk endpoint** — per the roadmap note exactly: a loop of the same
`PATCH /tickets/:id` the single-ticket UI already calls, fired with
`Promise.all` over the selected ids. No new backend code at all for this
part. The checkbox column uses a `display:contents` wrapper (`<Link
className="contents">`) around the rest of a row's cells so the existing
CSS grid layout is unaffected by introducing a `<Link>` that no longer wraps
the whole row (the checkbox must sit outside the navigation link, or
clicking it would also navigate to the ticket).

**Collision detection and bulk actions are both gated behind
`tickets:write`** — the same tier every other ticket-detail action already
uses (asset linking, adding a message, applying a macro). Merge is gated the
same way; nothing here introduces a new permission tier.

## Verified

9 new integration tests against real Postgres and Redis
(`apps/api/test/ticket-merge.test.ts`, `apps/api/test/presence.test.ts`):
merging moves the source's messages onto the target and adds a system note
on each side; the source closes and gets a `resolvedAt` if it didn't already
have one; the target's `mergedTickets` lists the source; merging a ticket
into itself, re-merging an already-merged ticket, and merging into an
already-merged target are all rejected with the right message; a nonexistent
source or target is rejected; presence correctly excludes the calling
viewer, is scoped per ticket, and is scoped per tenant (two tenants sharing
a ticket id by coincidence never see each other's viewers). Full suite
82/82 passing (9 skipped, unrelated), both `apps/api`/`apps/web` typecheck
clean.

Browser-verified end to end against the real running app: merged one ticket
into another and confirmed the source shows the "merged into" banner while
the target shows both the moved message and a "Merged from" note; confirmed
collision detection actually needs two *distinct* agent accounts to be
meaningful (an early version of this check that logged into the same
account twice never triggered the presence pill, since `listPresence`
correctly excludes the caller's own userId — this was the test being wrong,
not the feature) — created a second agent, opened the same ticket from two
separate logged-in browser contexts, and confirmed "Also viewing: Second
Agent" renders after the heartbeat interval; selected two tickets from the
queue via the new checkboxes and bulk-assigned both at once, confirming both
tickets show the new assignee immediately afterward. Zero console errors
throughout.

## Consequences / known v1 limitations

- Presence is exactly what it says: "recently active," not "currently
  looking at the reply box" — no typing indicator, no per-field lock.
- No chained-merge support — merging A into B, then wanting to merge B into
  C, is two separate operations; there's no automatic "also update anything
  that pointed at A."
- Bulk actions cover assignee/status/priority — the fields `updateTicket`
  already supports — not an arbitrary bulk-edit-anything UI; there's no
  ticket "tag" concept in this schema to bulk-apply, despite the roadmap
  note's loose use of the word.
- No bulk *merge* (selecting several tickets and merging them all into one
  target at once) — each merge is still a single source→target operation
  from the ticket detail page.
