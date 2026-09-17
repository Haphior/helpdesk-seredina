# ADR 0028: Configuration review pass — edit everywhere, reordering, webhook event fix

## Status

Accepted, implemented.

## Context

The third section of the user's requested review-then-fix pass, applying the
same four lenses to the Configuration nav group (Custom Fields, Service
Catalog, Process Templates, Macros, Webhooks, SLA Policies, On-Call &
Escalation, Business Hours — AI Usage and Data Export were already built and
reviewed earlier this session).

This section's dominant finding was structural, not a one-off bug: **6 of 8
configuration resource types could only be created and deleted, never
edited** — Custom Fields, Service Catalog Items, Macros, Webhooks, Process
Templates, and On-Call Schedules/Escalation Tiers. Only SLA Policies and
Business Hours (both already `upsert`-based) supported real editing. The user
confirmed fixing all of it rather than a partial scope.

## Decisions

**Each resource's update endpoint is scoped to what's actually safe to
change post-creation, not a blanket PATCH-everything.** The specific
exclusions, and why:

- **Custom Fields**: `key` and `fieldType` stay immutable. `key` is how a
  ticket's jsonb `customFields` blob references the definition; `fieldType`
  changing after values exist could leave a stored value that no longer
  matches its own field's type. `label`, `required`, `options` (SELECT), and
  `sortOrder` are all editable.
- **Webhooks**: editing url/events/`isActive` never touches
  `secretEncrypted` — rotating the signing secret is its own explicit
  `POST /webhooks/:id/rotate-secret` action (shown once, exactly like
  creation), never a side effect of an unrelated edit. Added `isActive` as a
  pause/resume toggle in the UI — the field already existed and was already
  honored by delivery dispatch (`WHERE isActive = true`), it just had no
  toggle anywhere.
- **Process Templates**: `kind` (GENERAL/CHANGE/RELEASE) stays immutable —
  switching kind after the fact would retroactively demand fields
  (riskLevel, a version) that already-started instances never had a chance
  to supply. Steps, when edited, are fully replaced (delete + recreate)
  rather than diffed — verified safe because `ProcessStepInstance` copies
  its label/sortOrder/requiresApproval at instance-creation time and holds
  no FK back to `ProcessStepTemplate` (confirmed by reading the schema
  comment, then proven by the new test that edits a template after starting
  an instance from it and asserts the running instance's steps are
  untouched).
- **On-Call Escalation Tiers**: only `escalateAfterMinutes` and `sortOrder`
  (reordering) are editable — changing *who* a tier notifies is left to
  delete+recreate, a consequential enough change that "start over" reads
  clearer than a partial edit.
- **Macros, Service Catalog Items, On-Call Schedules (rename)**: no
  exclusions beyond the obvious (a macro's update still enforces "at least
  one action," matching create's own validation).

**Reordering was added wherever `sortOrder` already existed but nothing set
it after creation** — Custom Fields and Escalation Tiers both had this gap
(the sort field was written once at insertion and never touched again).
Fixed with the identical swap-two-rows-by-sortOrder pattern `Dashboard.tsx`'s
widget reordering already established: move-up/move-down chevrons visible
on row hover, two `PATCH` calls in `Promise.all` swapping each row's
`sortOrder`.

**A real bug, not just a gap: the Webhooks creation form only offered 3 of
the 5 real event types.** `packages/shared/src/webhooks.ts`'s
`WEBHOOK_EVENTS` (the backend's actual source of truth, already correctly
validated against by the route's zod schema) has 5 values including
`sla.first_response_breached`/`sla.resolution_breached`; the frontend's
hardcoded `ALL_EVENTS` array and `WebhookEvent` type both only listed 3. A
tenant could never subscribe to either SLA-breach webhook through the
console, even though the backend already dispatched them correctly. Fixed
by correcting both the type and the constant, with a comment marking
`packages/shared/src/webhooks.ts` as the source of truth to hand-sync
against (the web app doesn't depend on `@seredina/shared`, so this can't be
enforced by the type system alone).

## Verified

7 new integration tests against real Postgres
(`apps/api/test/configuration-edits.test.ts`): Custom Field update edits
label/required/options/sortOrder while confirming key/fieldType stay
immutable; Service Catalog Item update edits fields and rejects a
name collision; Macro update edits actions and still enforces "at least one
action"; Webhook update edits url/events/isActive without ever touching the
secret, and `rotateWebhookSecret` issues a genuinely different one; Process
Template update replaces steps and — the one test worth calling out
specifically — proves an already-started instance's copied steps are
completely unaffected by editing the template afterward; On-Call Schedule
rename works and rejects a collision; Escalation Tier update edits minutes
and reorders via the sortOrder-swap pattern. Full suite 140/140 passing (9
skipped, unrelated), both `apps/api`/`apps/web` typecheck clean.

Browser-verified end to end via Playwright, one consolidated pass across
all six resource types plus the webhook fix: created and edited a Custom
Field, then reordered two fields via the move-up chevron and confirmed the
displayed order actually changed; created and edited a Service Catalog
Item; created and edited a Macro; on Webhooks — confirmed the creation form
now offers exactly 5 events (not 3), created one, paused/resumed it,
edited its event list, and rotated its secret, all reflected in the UI;
created and edited a Process Template, confirming the "kind can't change"
notice renders instead of the kind picker when editing; renamed an On-Call
schedule; created two Escalation Tiers, edited one's minutes (verified via
the input's actual value, not `textContent` — an early version of this
check was wrong for exactly the reason worth noting: an `<input>`'s value
is a property, never part of `textContent`), and reordered them, verified
by reading both rows' input values before and after and confirming they
swapped. Zero console errors.

## Consequences / known v1 limitations

- On-Call shifts still have no edit, only delete+re-add — lower cost than
  the resources fixed here (no secret, no delivery history, no started
  instances to protect), so left as-is for this pass.
- No audit trail of *who* edited a configuration resource or *when* — an
  edit silently overwrites, same as create/delete already did before this
  pass. Real change history would be a separate feature.
- Process Template step edits are delete-and-recreate under the hood, so a
  step's own `id` changes on every edit that touches steps — fine today
  since nothing external references a `ProcessStepTemplate` by id, but
  worth remembering if that ever changes.
