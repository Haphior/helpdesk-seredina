# ADR 0013: Change Enablement — a `kind` on the existing process engine, not a new model

## Status

Accepted, implemented.

## Context

Next item from the ITIL-verified competitive pass (docs/ROADMAP.md's Phase 2
additions). ITIL 4's own practice list names this "Change Enablement," not the
ITIL v3 "Change Management" the original roadmap note used — corrected there,
and used consistently here.

## Decisions

**A `ProcessTemplateKind` enum (`GENERAL` | `CHANGE`) on `ProcessTemplate`, not
a new `Change` model.** A Change request is, mechanically, exactly what the IT
Processes engine (ADR 0008) already does: multi-step, some steps approval-gated,
outlives a single ticket conversation. Building a parallel model for it would be
two systems pretending to be one — the same reasoning ADR 0003 used to keep
alert ingestion on `Ticket` instead of a new `Incident` model. A CAB sign-off is
just a `ProcessStepTemplate` with `requiresApproval: true`; nothing new needed
there at all.

**Four nullable fields added directly to `ProcessInstance`** (`riskLevel`,
`plannedStart`, `plannedEnd`, `rollbackPlan`), not a separate table — a Change
is a `ProcessInstance` with a bit of extra metadata, not a different kind of
thing. All four are null for every ordinary (`GENERAL`) process instance by
construction; nothing reads them unless `riskLevel` is set.

**`riskLevel` is required when starting an instance of a `CHANGE`-kind
template; the planned window and rollback plan are optional.** A Change
without any risk assessment isn't following the practice it's named after, so
that one field is enforced at the service layer (`startProcessInstance` throws
`'starting a change requires a risk level'` otherwise). The window and rollback
plan are useful, not enforced — real scope cut for a first pass, matching this
session's established posture (e.g. custom fields' `required` flag being
UI-only, ADR 0006) rather than inventing enforcement rules with no real
pressure behind them yet.

**A risk level provided against a `GENERAL` template is silently dropped, not
rejected.** The route always forwards whatever the client sent; the service
only persists the change fields when `template.kind === 'CHANGE'`. Simpler
than validating "you may only send this if..." for a shape that isn't
security-sensitive — worst case, a client sends a redundant field and it's a
no-op.

**Release Management (the roadmap's next-sequenced item) was deliberately left
out of this pass**, even though the roadmap note sequences it "right after
Change Enablement" — it needs its own `kind` value and its own field set
(build/stage/deploy/confirm), and bolting it onto this migration would have
mixed two ITIL practices into one commit for no real benefit. The enum is
already shaped to add a third value later without touching what's built here.

## Verified

4 new integration tests against real Postgres (`apps/api/test/processes.test.ts`):
a `GENERAL` template never requires a risk level; starting an instance of a
`CHANGE` template without one is rejected with the exact expected message; a
`CHANGE` instance correctly stores risk level, planned window, and rollback
plan while its approval-gated step works completely unmodified; a risk level
sent against a `GENERAL` template is confirmed *not* stored. Full suite 43/43
green, both `apps/api` and `apps/web` typecheck clean.

Browser-verified end to end against the real running app: created a
`CHANGE`-kind template ("Firewall Rule Change") with a CAB-approval step and
an apply step, confirmed the "Change" badge shows on the template list,
started an instance choosing HIGH risk and a rollback plan, confirmed the risk
badge renders on both the process list and detail page, confirmed the Change
Enablement panel shows the rollback plan, and confirmed the CAB approval step
still only offers APPROVED/REJECTED/SKIPPED (never a plain DONE) — the exact
same approval-gating mechanism `GENERAL` processes already used, completely
unmodified by this change. Zero console errors.

## Consequences / known v1 limitations

- No risk *scoring* (a formula from blast radius, past incident history,
  etc.) — `riskLevel` is a plain three-value choice an agent picks, same
  posture as `TicketPriority`.
- No freeze-window enforcement (blocking a Change from starting during a
  declared change freeze) — `plannedStart`/`plannedEnd` are informational
  only in this pass.
- Release Management and Problem Management, both explicitly sequenced after
  this in the roadmap, are not built yet — this ADR's `kind` enum is shaped to
  extend for the former; the latter needs its own small model (a `Problem`
  record linking several `Ticket`s), not an extension of this one.
