# ADR 0020: On-call scheduling + SLA escalation chains

## Status

Accepted, implemented.

## Context

"The direct sequel to this pass's SLA engine, not a separate concern —
Opsgenie-inside-Jira-SM is the clearest competitive example of exactly this
combination." The SLA engine (ADR 0011) already dispatches
`sla.first_response_breached`/`sla.resolution_breached` webhooks; nothing
inside Seredina itself consumed them. This adds what receives them: an
on-call rotation and an escalation chain that notifies tier 1, and moves to
tier 2, 3, ... if nobody acknowledges in time.

## Decisions

**Four new models, no policy wrapper around the escalation chain.**
`OnCallSchedule` + `OnCallShift` are named explicitly in the roadmap note
("whoever's on shift right now"). The escalation chain itself is one
ordered list of `EscalationTier` rows per tenant — like `BusinessHours`,
at most meaningfully one per tenant for a first pass, so there's no separate
`EscalationPolicy` name/wrapper to manage. `EscalationRun` tracks one live
escalation-in-progress per SLA breach that actually started one.

**Every tier notifies exactly one of a fixed user or "whoever's on shift for
this schedule"** — `EscalationTier.userId` XOR `onCallScheduleId`, enforced
at the service layer (`createEscalationTier` rejects both-set and
neither-set). This is the one design choice that makes a chain able to mix
"page the on-call rotation" tiers with "always page the team lead directly"
tiers, without two different tier shapes.

**`escalateAfterMinutes` is meaningful on every tier, including the last** —
not just the ones with a "next" tier to fall through to. On the last tier,
it's the give-up timeout: if that tier's own wait elapses unacknowledged,
the run becomes `EXHAUSTED` rather than silently having nothing scheduled
after it. This removed a special case the roadmap note didn't call out but
that fell out naturally once the engine was written as "notify a tier, then
always schedule one re-check after its delay" rather than "schedule a
re-check only if there's a next tier."

**The escalation engine lives entirely in `apps/worker`, duplicating a
handful of lines against `@seredina/db` directly rather than calling into
`apps/api`'s `modules/oncall/service.ts`.** Confirmed by checking
`apps/worker/package.json`: it depends on `@seredina/db` and
`@seredina/shared` only, never `@seredina/api` — apps/worker has never
imported apps/api code (the existing `checkSlaBreach.ts` doesn't either,
even though `computeSlaDueAts` lives in apps/api). `apps/api`'s
`oncall/service.ts` exists for the CRUD the admin UI needs
(schedules/shifts/tiers) and for `acknowledgeEscalation` (called from a
ticket's own "Acknowledge" button); `apps/worker/src/oncall/escalate.ts` is
the separate, worker-side engine that actually starts and advances a run.

**The worker is its own escalation-advance job's producer AND consumer** —
a new `apps/worker/src/lib/queue.ts` (extending, not replacing, the
existing one that already produced `webhookDeliveryQueue`) holds a
`Queue<EscalationAdvanceJobPayload>` the worker enqueues from
`startEscalationIfConfigured`/`advanceEscalation` after notifying each tier,
consumed by a new `Worker` registered in `apps/worker/src/index.ts` for the
same queue name. This is "consumes the same breach-check delayed-job
mechanism already built rather than a second scheduler" taken literally:
the *pattern* (a delayed BullMQ job that re-checks live state when it
fires, exactly like `checkSlaBreach.ts` already does) is reused, even
though it's necessarily a new queue name (a genuinely different job
payload) rather than the literal same queue.

**Every advance re-checks the run's live `status` and `currentTierIndex`
before acting** — a stale job (the run was acknowledged, or somehow already
advanced) is a silent no-op, the identical "trust nothing captured at
schedule time" posture `checkSlaBreach` already uses for the SLA breach
check itself.

**Escalation system notes are private** (`isPrivateNote: true`) — unlike the
ticket-merge system notes (ADR 0019), which are public. A note that names a
specific internal on-call person by name is squarely internal-ops
information; a contact should never see it if this thread is ever
email-relayed.

**No test infrastructure was added for `apps/worker`, matching an existing
gap rather than introducing a new one.** `checkSlaBreach` itself — the SLA
engine's own worker-side breach-check-and-webhook-dispatch logic — has no
automated tests anywhere in this codebase; only its API-side scheduling
(`computeSlaDueAts`, `scheduleSlaBreachChecks`) is tested. `startEscalationIfConfigured`/`advanceEscalation`
follow that same precedent and are verified by the full real-time browser
pass below instead. What *is* tested with real integration tests is
everything on the `apps/api` side: schedule/shift CRUD, `whoIsOnShift`,
escalation-tier CRUD and validation, and the acknowledge path.

## Verified

9 new integration tests against real Postgres
(`apps/api/test/oncall.test.ts`): schedule creation rejects a duplicate
name; adding a shift rejects an end before its start; `whoIsOnShift` finds
the shift covering "now" and returns null outside any shift; deleting a
shift removes only that shift, deleting a schedule cascades its shifts;
creating a tier rejects naming both a user and a schedule, or neither, and
rejects a non-positive `escalateAfterMinutes`; tiers append with increasing
`sortOrder` and delete removes just the one tier; acknowledging with no
active run is rejected, and acknowledging a real active run records who and
when. Full suite 91/91 passing (9 skipped, unrelated), all three of
`apps/api`/`apps/web`/`apps/worker` typecheck clean.

Browser-verified end to end against the real running app **with the actual
worker process live** (not simulated): set a 1-minute first-response SLA,
created two agents, built a real 2-tier escalation chain (1 minute per
tier) on the new On-Call & Escalation admin page, created a ticket via the
API-key path and deliberately never responded to it, then watched — in real
time, across roughly 2.5 real minutes of actual delayed-job execution — the
SLA breach fire, the escalation start at tier 1 with a system note naming
the first agent, tier 1's window elapse unacknowledged, the chain advance
to tier 2 with a second system note, and finally clicked "Acknowledge" and
confirmed the banner updated to show who acknowledged it and when. Zero
console errors throughout.

## Consequences / known v1 limitations

- No test infrastructure added for `apps/worker` (see the decision above) —
  the engine itself is verified by the real-time browser pass, not
  automated integration tests, matching this codebase's existing precedent
  for worker-side job handlers.
- `EscalationRunStatus.EXHAUSTED` is a dead end in v1 — no auto-retry, no
  "page everyone at once" fallback, no integration with an actual paging
  service (SMS/phone/push). The "notification" is a private ticket note,
  not an outbound page — reusing the messaging mechanism this codebase
  already has, rather than adding a new delivery channel.
- Overlapping shifts on the same schedule aren't prevented; `whoIsOnShift`
  just returns the first match.
- One escalation chain per tenant, not one per priority or per team — a
  tenant that wants different chains for different ticket types isn't
  modeled yet.
