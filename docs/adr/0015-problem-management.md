# ADR 0015: Problem Management — its own small model, not another process kind

## Status

Accepted, implemented.

## Context

Next item from the ITIL-verified roadmap, sequenced after Release Management
(ADR 0014). Jira Service Management and ITIL 4 both treat a Problem (a root
cause) as a first-class concept distinct from the Ticket/Incident it's
causing — the same underlying fault can produce many incidents, and a Problem
tracks that fault's investigation, workaround, and eventual fix independently
of any one incident's own lifecycle.

## Decisions

**A new `Problem` model, not a third `ProcessTemplateKind`.** Change
Enablement and Release Management (ADRs 0013, 0014) both extended the IT
Processes engine because a Change or a Release genuinely *is* a checklist —
CAB approval, then apply; build, stage, deploy, confirm. A Problem isn't a
checklist. It doesn't have steps that get marked done in order; it has a
root cause that gets investigated, a workaround that may exist before a
permanent fix does, and a set of *tickets* it explains — a fundamentally
different shape. Forcing it into `ProcessInstance` would mean bolting on
fields (`rootCause`, `workaround`, a many-ticket link) that make no sense for
an onboarding checklist or a CAB approval, the same "two systems pretending
to be one" trade-off ADR 0013 rejected in the other direction. This was
already flagged as the plan in ADR 0014's Consequences section.

**One-way `Ticket.problemId` (many Tickets → one Problem), not a many-to-many
join table.** ITIL frames this as "one incident, one root cause" — a ticket
symptomatic of two unrelated problems at once isn't a case this needs to
model for a first pass, and a plain FK is simpler than a join table for the
common case. Reusing the existing `PATCH /tickets/:id` endpoint (adding
`problemId` alongside the already-there `teamId`/`assigneeId` pattern) means
linking a ticket to a Problem needed zero new endpoints — it's an ordinary
ticket property edit, both from the ticket side (a "Problem" dropdown next to
Team/Assignee) and, in the frontend, from the Problem page too (a "link an
existing ticket" control that PATCHes the ticket).

**Sequential `Problem.number`, generated the exact same way as
`Ticket.number`** — an atomic `Tenant.lastProblemNumber` increment inside the
tenant transaction, not a shared counter with tickets. Problems and Tickets
are different sequences (a tenant's first Problem is "#1" even if they
already have 500 tickets), matching how Jira Service Management numbers
Problems independently from Incidents.

**`changeInstanceId` on `Problem`, an optional FK into `ProcessInstance`** —
"a real problem management workflow usually produces a change request as its
fix" (docs/ROADMAP.md). Same `onDelete: SetNull` posture as every other
optional FK in this schema (ADR 0008's lesson about never trusting Prisma's
default). Deliberately **not** validated to be `CHANGE`-kind specifically —
the service only checks the linked instance exists, not its kind, the same
scope cut ADR 0014 made for `Release.changeInstanceId`.

**`resolvedAt` set on the first transition into `RESOLVED`/`CLOSED`, cleared
on any transition back out** — identical logic to how `Ticket.resolvedAt`
already behaves on a status-category change, so a Problem re-opened after a
fix didn't hold doesn't keep showing a stale resolution timestamp, and a
Problem bounced between `RESOLVED` and `CLOSED` doesn't have its resolution
date pushed forward on every touch.

## Verified

5 new integration tests against real Postgres
(`apps/api/test/problems.test.ts`): a Problem gets a sequential number and
starts `UNDER_INVESTIGATION`; linking/unlinking tickets via the existing
`updateTicket` path actually connects/disconnects (not a silent no-op);
`resolvedAt` is set on the first `RESOLVED`/`CLOSED` transition, stays fixed
across further `RESOLVED`↔`CLOSED` moves, and clears on reopening; an
optional link to a real `CHANGE` instance persists and a nonexistent
`changeInstanceId` is rejected; the list endpoint orders newest-number-first.
Full suite 52/52 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean.

Browser-verified end to end against the real running app: created two real
tickets via the `/v1/tickets` API-key path, created a Problem through the new
`/problems` page, linked both tickets from the Problem detail page, filled in
root cause and workaround (auto-saved on blur), changed status to
`KNOWN_ERROR` (badge updates immediately, values survive a page reload),
unlinked one ticket and confirmed it dropped off the list, then confirmed the
*other* ticket's own detail page shows a working "Problem" dropdown plus a
"View Problem #1 →" back-link into the Problem page. Zero console errors
throughout.

## Consequences / known v1 limitations

- No automatic Problem detection (e.g. clustering similar tickets and
  suggesting a Problem) — creating one, and linking tickets to it, is a fully
  manual agent action in this pass.
- No enforcement that a linked `changeInstanceId` is actually `CHANGE`-kind
  or has completed — informational only, same posture as Release
  Management's Change link.
- A ticket can only ever link to one Problem at a time (`problemId` is a
  single nullable FK, not a many-to-many join) — matches ITIL's own framing,
  revisit only if a real multi-root-cause case shows up.
- Service Configuration Management and Service Catalog, the roadmap's
  remaining Phase 2 items, are unrelated to this model and still open.
