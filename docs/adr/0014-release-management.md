# ADR 0014: Release Management — a third `kind` on the same process engine

## Status

Accepted, implemented.

## Context

Next item from the ITIL-verified roadmap, sequenced right after Change
Enablement (ADR 0013). ITIL 4 treats Release Management as its own distinct
practice from Change Enablement — a Change is the approval to make a change;
a Release is the coordinated act of shipping it, which is often (not always)
approved by a prior Change.

## Decisions

**`ProcessTemplateKind` extended to `GENERAL | CHANGE | RELEASE`, not a new
model.** ADR 0013 already left the enum shaped for this. A Release is,
mechanically, the same thing a Change is: a multi-step, sometimes
approval-gated checklist that outlives a single ticket. Build/stage/deploy/
confirm is just a template's step list, same as CAB-approval/apply was for a
Change — no new mechanism needed.

**`releaseVersion` and `changeInstanceId` added to `ProcessInstance`**;
`plannedStart`, `plannedEnd`, and `rollbackPlan` — already on the model for
Change Enablement — are reused as-is rather than duplicated, since a planned
window and a rollback plan mean the same thing for a Release as for a Change.
`changeInstanceId` is a **self-relation** (`ProcessInstance.changeInstance` →
another `ProcessInstance`), modeling "this Release was approved by that
Change" directly, instead of a generic `relatedInstanceId` that would allow
nonsensical links (a Release "approved by" another Release). `onDelete:
SetNull` is explicit on the FK — the linked Change can be deleted without
taking the Release down with it, matching ADR 0008's lesson about never
trusting Prisma's default `onDelete` for an optional relation.

**`releaseVersion` is required when starting an instance of a `RELEASE`-kind
template; `changeInstanceId`, the planned window, and rollback plan are
optional.** A Release nobody can identify by version isn't a release; a
Release without a linked Change is still common (routine releases outside
formal change control) so the link is offered, not forced. The service
validates a passed `changeInstanceId` actually resolves to an existing
instance (`'linked change instance not found'`) but does **not** check that
the linked instance is itself `CHANGE`-kind — a deliberate simplification:
enforcing that would mean either an extra fetch-and-check or a DB constraint
neither of which resists someone editing another Release's ID in later by
hand, and there is no security property being protected here (both instances
already belong to the tenant, verified by RLS/`withTenantTx`). If this
becomes a real source of confused data, revisit with a targeted validation.

**A `releaseVersion` provided against a `GENERAL` (or `CHANGE`) template is
silently dropped, not rejected** — the same posture ADR 0013 took for
`riskLevel` against `GENERAL`. Simpler than validating "you may only send
this if...", and not security-sensitive.

**Frontend**: `PlannedWindowFields`, originally written inline inside the
Change block of `StartProcessModal`, was extracted into its own top-level
component so both the Change and Release conditional blocks call the same
JSX instead of duplicating it. `ProcessDetail`'s Release Management panel
shows the linked Change as a clickable link (`instance.changeInstance.subject`
included in `getProcessInstance`'s response) rather than a bare ID.

## Verified

4 new integration tests against real Postgres
(`apps/api/test/processes.test.ts`, full file now 13/13): starting a
`RELEASE`-kind instance without a version is rejected with the exact expected
message; a `RELEASE` instance correctly stores its version, an optional link
to a real `CHANGE` instance, planned window, and rollback plan, while
`riskLevel` stays null (proving the two kinds' fields don't cross-contaminate);
a `changeInstanceId` that doesn't resolve to a real instance is rejected; a
version sent against a `GENERAL` template is confirmed *not* stored. Full
suite 47/47 passing (9 skipped, unrelated to this change), both `apps/api`
and `apps/web` typecheck clean.

Browser-verified end to end against the real running app: created a
`CHANGE`-kind template and a `RELEASE`-kind template, confirmed both badges
render on the template list, started a Change instance (HIGH risk), started a
Release instance with a version and the Change linked via the "Approved by
which Change?" dropdown plus a rollback plan, confirmed the version badge
renders on the process list, confirmed the Release Management panel on the
detail page shows the version, a working link to the linked Change's detail
page, and the rollback plan, and confirmed the Change instance's own detail
page still renders its unmodified Change Enablement panel alongside it. Zero
console errors throughout.

## Consequences / known v1 limitations

- No enforcement that a linked `changeInstanceId` is actually `CHANGE`-kind,
  or that it's `COMPLETED`/approved before the Release starts — the link is
  informational in this pass, same posture as the planned window.
- No release-specific automation (e.g. auto-creating a Release from an
  approved Change, or blocking a Release from starting without one) — that's
  workflow-automation-engine territory, already deferred in the roadmap's
  Backlog section.
- Problem Management, the roadmap's next-sequenced item, still needs its own
  small model (a `Problem` record linking several `Ticket`s) rather than an
  extension of this `kind` enum — a Problem isn't a checklist, it's a
  root-cause record.
