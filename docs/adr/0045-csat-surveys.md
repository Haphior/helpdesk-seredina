# ADR 0045: Customer satisfaction (CSAT) surveys

## Status

Accepted, implemented.

## Context

`docs/ROADMAP.md`'s backlog named "Advanced reporting/CSAT/export" as still open. Export
had already shipped (Phase 2's data-portability differentiator); CSAT — asking a
customer to rate their experience once their ticket is resolved — was the concrete,
well-scoped, no-external-blocker slice left in that line: unlike Slack/Teams (needs a
real OAuth app) or WhatsApp (needs Meta Business verification), this is entirely
Seredina's own surface.

## Approach

**Storage — `CsatResponse`, one row per ticket, created at most once.** `token` (a
public survey-link credential, same shape as `Ticket.widgetToken`), `rating`/`comment`
nullable until answered, `requestedAt`/`respondedAt`. A dedicated model rather than
fields on `Ticket` directly: it has its own lifecycle (requested vs. answered) and
public-facing access pattern that doesn't belong mixed into the ticket record itself.

**Trigger — the exact moment a ticket first counts as "done."** `updateTicket`
already computes this: `resolvedAt` gets stamped once, on whichever status transition
gets there first (landing on a `RESOLVED` category, or skipping straight to `CLOSED`).
A new `justResolved` boolean captures that same moment (both branches, not just one)
and, after the transaction closes, calls `createCsatSurveyLink` — reopening and
re-resolving a ticket never sends a second survey, since `CsatResponse.ticketId` is
unique and the create is a no-op once a row exists.

**Distribution — post it as a message, don't build a second send path.** The survey
link is posted as a `SYSTEM`-authored, non-private `Message` through the *existing*
`addMessage` function — not a direct `tx.message.create` the way every other `SYSTEM`
message in this codebase has worked until now (alert re-fires, escalation notes).
That choice is what makes the link actually reach the customer for free: `addMessage`
already decides `shouldEmail`/`shouldTelegram` from the ticket's own channel, so an
email- or Telegram-sourced ticket's survey goes out through the exact same mechanism
a real agent reply would use, and a widget-sourced ticket's visitor sees it appear in
their already-polled conversation view. No new distribution channel was built —
CSAT rides on infrastructure ADR 0040 and ADR 0044 already built for a different
reason.

**Public survey page — `/csat/:tenantSlug/:token`.** Same `/public/:tenantSlug/...`
shape as the KB portal and status page (`resolveTenantIdBySlug`, 404 identically for
an unknown slug or an unknown token). `GET` returns the ticket's subject/number and
current answer (if any); `POST` records `rating` (1-5) and an optional `comment`.
Submitting twice is idempotent, not an error or a silent overwrite: the first answer
wins, so a double-click or a reload after submitting can never risk replacing a
customer's real answer with something else. A shared `PortalBrand` component (ADR
0043) gives it the tenant's own logo/accent, same as the other two public pages.

**Link construction needs the web app's own public URL — reusing `WEB_ORIGIN`, not a
new variable.** `WEB_ORIGIN` already existed in `.env.example`, documented as "must
match how the browser reaches" the web app — exactly what a survey link's base URL
needs, so no new env var was introduced. Unlike Telegram's `API_PUBLIC_URL` (a hard
requirement for that connect action), an unset `WEB_ORIGIN` here is a **silent,
best-effort no-op**: `createCsatSurveyLink` returns `null` and no survey is
requested, the same "no channel configured" posture `sendNotificationEmail` already
has. Resolving a ticket is a routine, frequent action — it must never hard-fail
just because CSAT's link-building isn't configured.

**A real correctness bug, found and fixed before this could ship a worse one.**
`addMessage`'s `firstRespondedAt` stamping used `authorType !== 'CONTACT'` — a
block-list. This CSAT feature is the first time a `SYSTEM` message goes through
`addMessage` at all; without narrowing that check, an agent who resolves a ticket
directly (bulk action, quick status change) without ever having typed a reply would
have had its SLA "first response" milestone incorrectly credited to an automated
survey link, not a real human response. Fixed by switching to an explicit allow-list:
`authorType === 'AGENT' || authorType === 'AI'`. Caught by writing the test *before*
trusting the feature ("the survey SYSTEM message does not stamp firstRespondedAt"),
not discovered live — the inverse of ADR 0044's bug, which surfaced only once real
jobs hit a real running worker.

**Reporting — one more aggregation function, the established shape.**
`getCsatSummary(tenantId, days=90)` in the same `modules/reporting/service.ts` every
other dashboard aggregate already lives in: total responses, average rating, and a
1-5 distribution, counting only *answered* surveys within the window (a requested-
but-ignored survey — the common case, most links never get clicked — must not drag
the average down or inflate the response count). A new `csat_score` dashboard
widget slots into the existing `WIDGET_TYPES`/`DEFAULT_ORDER` catalog exactly like
`sla_compliance` did — no new widget infrastructure.

## Consequences

- CSAT delivery quality is only as good as the ticket's own channel already is: an
  `agent`/`api`/`catalog`-originated ticket has no outbound push mechanism to the
  contact at all (matching those channels' existing reality, not a CSAT-specific
  gap), so the survey link exists and is answerable if reached, but nothing proactively
  delivers it to that contact. Only email and Telegram tickets get pushed a survey
  message; widget tickets surface it in their own polled view.
- If a future channel needs its own outbound push (e.g., WhatsApp), CSAT needs no
  changes at all — `shouldNotifyCustomer`'s channel check in `addMessage` is the only
  place that would need a new branch, already established by the email/Telegram
  precedent.

## Verified

11 integration tests (`apps/api/test/csat.test.ts`, live Postgres): resolving a
ticket posts exactly one SYSTEM survey message; reopening and re-resolving never
sends a second one; closing directly (skipping RESOLVED) still triggers it; an unset
`WEB_ORIGIN` silently skips survey creation entirely (no row, no message); the
survey message never stamps `firstRespondedAt` (the regression test for the bug
above); the public survey view and submission round-trip correctly; a second
submission is idempotent, not overwritten; an out-of-range rating is rejected; an
unknown token or unknown tenant slug both 404 identically; RLS isolation between
tenants; and `getCsatSummary` correctly averages only answered surveys, excluding
unanswered ones from both the count and the average. Full `apps/api` suite 261/261
green (was 250 before this pass); every touched workspace typechecks and builds
clean.

Live, against the real running dev stack: created a ticket through the real UI,
resolved it via the status dropdown, and confirmed the exact survey-link SYSTEM
message appears in the thread. Opened that real link in a separate browser context
(as the customer would, unauthenticated), rated it 4 stars with a comment, and
confirmed the thank-you state. Reloaded the same link and confirmed it shows the
already-submitted state rather than resetting (idempotency, not just asserted in a
test). Confirmed the Dashboard's new "Customer satisfaction" widget correctly shows
the real 4/5 average and distribution immediately after — no separate refresh or
cache-clear needed. Zero console errors throughout.
