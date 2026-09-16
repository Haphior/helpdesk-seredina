# ADR 0006: Custom fields — jsonb only, no typed mirror table yet

## Status

Accepted, implemented. A deliberate v1 scope cut, documented below, not an
oversight.

## Context

Phase 2's Configuration Management item, and the first concrete piece of the
"fully configurable" pitch that's been true only in the abstract until now —
tenant-defined `TicketStatus` labels (Phase 1) generalize the same idea, but
custom fields are the first case where a tenant defines an entirely new field
that didn't exist in the schema at all. The original roadmap note already named
the target shape: "hybrid values (jsonb column for the common case, a narrow
typed mirror table only for fields explicitly marked filterable — avoids full
EAV)." This pass builds the jsonb half only.

## Decisions

**`CustomFieldDefinition` (tenant-scoped, RLS + `TENANT_SCOPE_FIELD` like every
other table) + a single `Ticket.customFields Json?` column.** Five field types
(`TEXT`, `NUMBER`, `BOOLEAN`, `DATE`, `SELECT`); `options` only meaningful for
`SELECT`, enforced at the service layer (forced to `[]` for every other type on
create), not a DB constraint — same validation posture as the rest of this
codebase (zod at the boundary, not CHECK constraints).

**No typed mirror table in this pass.** The roadmap's original plan was hybrid
specifically so tenant reporting/filtering on a custom field wouldn't require a
full jsonb scan. Building that now would be speculative — there's no reporting
feature yet to filter for (Phase 2's own Reporting v1 item is still unbuilt), so
the typed-mirror complexity has nothing real to prove itself against yet.
Revisit when Reporting v1 actually needs to filter/aggregate by a custom field's
value; until then a straight `jsonb` column is strictly less code for the same
correctness.

**PATCH merges into the existing `customFields`, never replaces it wholesale.**
`updateTicket` in `modules/tickets/service.ts` spreads the ticket's current
`customFields` under the incoming patch's keys. Getting this wrong (naively
setting `data.customFields = input.customFields`) would mean editing one custom
field silently blanks out every other one already stored the moment a second
field exists — covered by an automated test (`test/custom-fields.test.ts`)
specifically because it's the kind of bug that looks correct in a one-field
manual test and breaks the moment a tenant has two.

**Reading definitions is `tickets:read`; defining them is `tickets:manage_all`.**
Every agent working a ticket needs to see and fill in whatever custom fields
exist — this isn't optional configuration UI, it's part of the ticket detail
view any agent opens. Only creating/deleting a definition (a tenant-wide,
GLPI-parity "Configuration Management" concern) is restricted to admin/team_lead,
the same tier that already manages email channels and bulk ticket operations.

**Deleting a definition leaves orphaned jsonb keys on tickets, not cleaned up.**
A deleted field's stored values on existing tickets become inert (the key still
exists in `customFields`, nothing renders it since no definition matches it
anymore) rather than being swept in a migration-style cleanup job. Cheaper and
safer than a bulk jsonb rewrite across every ticket for what's expected to be a
rare admin action; the orphaned data is harmless dead weight, not a correctness
or security issue.

**`required` is a UI-only hint in this pass, not enforced.** The checkbox exists
in the create-field form and renders a `required` badge in the settings list,
but nothing currently blocks saving a ticket that's missing a required custom
field's value. Real enforcement needs a decision about exactly when it applies
(ticket creation? Every status transition? Only reaching a resolved category?)
that doesn't have an answer yet — shipping a half-considered enforcement rule
felt worse than shipping an honest UI-only hint and revisiting once there's a
real answer.

## Verified

Real Postgres, not mocked: migration applies cleanly, RLS policy confirmed
present via `pg_policies`. Three new automated tests
(`test/custom-fields.test.ts`) prove definition creation defaults (a TEXT
field's `options` never leaks from a SELECT field's), the duplicate-key error is
the clean service-layer message rather than a raw Prisma constraint string, and
specifically the merge-not-replace behavior across three sequential patches.
Full existing suite still green (15/15 across all five test files).

Browser-verified end to end: created a TEXT, a SELECT, and a required BOOLEAN
field as an admin, confirmed all three render correctly on a real ticket's
details panel with zero console errors, edited each one (text via blur-commit,
select via immediate commit, checkbox via immediate commit) and confirmed the
values persist across a full page reload — a real round trip through
`PATCH /tickets/:id`, not a mocked assertion.

## Consequences / known v1 limitations

- No typed mirror table / filtering support (see above) — a custom field's
  value cannot be searched, filtered, or reported on yet.
- `required` is not enforced anywhere.
- No custom fields on `Asset` yet, even though the original roadmap note
  mentioned extending the same pattern there ("extended to Asset too").
- No drag-and-drop `TicketForm` layout customization — fields render in
  `sortOrder` (creation order), not a tenant-arranged layout. That's a separate,
  larger GLPI-parity item still open.
- Text/number/date inputs commit on blur, not on every keystroke, to avoid a
  `PATCH` per character — a select/checkbox commits immediately since a single
  discrete interaction already is the "done typing" signal.
