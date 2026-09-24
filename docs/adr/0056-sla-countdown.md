# ADR 0056: SLA countdown, typing indicator, and reply-collision warning

## Status

Accepted, implemented.

## Context

Two follow-ups to live console updates (ADR 0053):

- **SLA.** The queue showed no SLA information at all. The ticket page showed
  only an absolute "Due 22/09 18:00", so an agent had to do the arithmetic to
  know whether a ticket was about to breach.
- **Two agents answering the same ticket.** Presence (ADR 0019) says who has a
  ticket open, but not who is writing. Nothing warned an agent that a
  colleague — or the customer — had just posted while they were still
  drafting.

## Decision

### SLA countdown

- **Queue:** an SLA column shows the next milestone to come due (first
  response if still pending, else resolution) as time left: `2d 4h`,
  `3h 20m`, and `9m 05s` in the last ten minutes. It turns **amber** once 75%
  of the window is used and **red** once breached ("5m overdue").
- **Ticket page:** each pending milestone gets the countdown, a progress bar
  and the exact due time. A met milestone shows "Met …" as before.
- **One clock per page.** `useNow()` (`apps/web/src/lib/sla.ts`) is a single
  shared one-second ticker, subscribed through `useSyncExternalStore`. It is
  not a `setInterval` per row. Only the countdown cells subscribe, so each
  tick re-renders them and not the whole queue.
- **Business hours are already in the due-ats.** `computeSlaDueAts` resolves
  business-hours policies to wall-clock instants, so wall-clock time left is
  the real time left. The countdown doesn't pause itself.

**`Ticket.slaStartedAt` (new, nullable).** "Share of the window used" needs
the window's start. A priority change recomputes both due-ats *from that
moment* (ADR 0011). Measured from `createdAt`, a ticket reclassified to
URGENT would look barely started when its 15-minute clock is nearly gone.
The column is set on creation and on each priority change, and left null when
no SLA policy applies. Tickets from before it existed fall back to
`createdAt`.

### "Ana is typing…"

- The composer calls `POST /tickets/:id/typing` at most every 2.5 s while its
  text is non-empty. It is best-effort, `tickets:write`, and rate limited to
  60/min.
- The API publishes a live event `{ type: 'ticket.typing', ticketId, userId }`
  (ADR 0053's channel). **Nothing of the draft is sent**, and nothing is
  stored. `parseLiveEvent` keeps only the ids declared for each type.
- Colleagues with that ticket open see "Ana is typing…". Each name fades after
  6 s without a ping, on the same shared clock, and clears as soon as that
  ticket's `message.created` arrives. Your own pings are ignored.

### Reply-collision warning

When a draft starts, the page remembers which message ids were already on
screen. When a new message by someone else shows up while you're still
drafting (it arrives live), an amber notice appears above the composer, with
wording for each case:

- a colleague's public reply: check it before sending, so the customer
  doesn't get two answers;
- a colleague's internal note;
- the customer writing back.

It compares **ids, not timestamps**, so the browser's and server's clocks never
have to agree. "Got it" dismisses it for the messages seen so far, and sending
clears it. It only warns: blocking the send would get in the way of the legit
case of two complementary replies.

## Not done

- **An "at risk" filter in the queue.** Filtering only the loaded page would be
  misleading. It needs a server-side filter over due-ats, deferred.
- **A notification when a ticket turns amber.** That needs a server-side timer
  per milestone like the breach checks (ADR 0011), and was left for later.

## Verified

- **Integration tests:**
  - `slaStartedAt` is set at creation;
  - a priority change resets it, and it matches the recomputed due-at;
  - patching anything else leaves it alone;
  - it stays null without a policy;
  - a typing ping reaches a colleague as ids only, never another tenant, and
    never carries the request body;
  - a bad ticket id is refused;
  - typing needs `tickets:write`.
- **Unit tests:** a typing event keeps exactly its two ids.

Live in Chromium, with two agents in separate browser sessions on the same
ticket:

- the queue's SLA column ticked down, and turned amber and red at the
  thresholds;
- while one agent typed, the other saw "… is typing…", which went away after
  the reply was sent;
- the reply arriving mid-draft raised the collision notice.
