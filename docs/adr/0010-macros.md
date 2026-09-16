# ADR 0010: Macros — a typed action union, not arbitrary code

## Status

Accepted, implemented.

## Context

Phase 2's Configuration Management list included `Macro` since the original
Phase 0 planning pass ("a typed action union, not arbitrary code" — see
`docs/ROADMAP.md`'s Phase 0 schema highlights). A macro is a one-shot bundle
of actions an agent applies instantly to a single ticket they're looking at
— "escalate and acknowledge" in one click, instead of setting priority, then
team, then typing the same canned reply every time. This is deliberately a
different shape from `ProcessInstance` (ADR 0008): a process is a multi-step,
possibly-approval-gated workflow that spans time; a macro is instant and
single-shot.

## Decisions

**`Macro.actions` is a typed union stored as jsonb, not a script.** The
`MacroActions` interface (`setStatusId`, `setPriority`, `setTeamId`,
`setAssigneeId`, `addReply: { body, isPrivateNote }`) is exhaustive and
every field optional — a macro applies only the ones it set. Adding a new
capability means adding a field here and a branch in `applyMacro`, never
letting a tenant supply logic that runs inside this process. Same reasoning
as the plugin/extension architecture recommendation in `docs/ROADMAP.md`'s
Phase 2 section: in cloud mode this is one shared process across every
tenant, so anything that lets a tenant's own logic execute inside it is a
direct route around RLS + Prisma-extension tenant isolation. `createMacro`
validates via `hasAnyAction()` that at least one field is set — an
all-empty macro is rejected at creation, not silently allowed to do nothing
when applied.

**`applyMacro` calls `updateTicket`/`addMessage` from the tickets module,
never duplicates their logic.** This is the same reuse principle used for
alert ingestion (ADR 0003) and, before that, for every other feature this
session that touches a ticket's state. Concretely it means a macro's
effects automatically get webhook dispatch (`ticket.updated`,
`message.created`), `resolvedAt`/`closedAt` stamping, and internal-note
handling for free, and can never drift from what a human clicking through
the UI one field at a time would get. The alternative — writing the field
updates directly in `applyMacro` — would have been less code today and a
guaranteed second implementation to keep in sync forever after.

**Field updates and the reply are two separate calls, not one combined
write.** `hasFieldUpdate` batches `setStatusId`/`setPriority`/`setTeamId`/
`setAssigneeId` into a single `updateTicket` call (one `ticket.updated`
webhook, not four), then `addReply` — if present — is a separate
`addMessage` call afterward. A macro that only sets a reply skips the
`updateTicket` call entirely rather than calling it with all-undefined
fields.

**Listing/applying macros is `tickets:write`; defining/deleting one is
`tickets:manage_all`.** The same split established for custom fields (ADR
0006) and process templates (ADR 0008), and the same mistake caught again
on the first pass here: `GET /macros` was initially gated
`tickets:manage_all`, which would 403 a plain agent trying to see what
macros exist to run one on a ticket they're already allowed to work.
Fixed to `tickets:write` before shipping — any agent working a ticket can
list and apply macros; only creating or deleting one (tenant-wide
configuration) requires admin/team_lead.

**No macro categories, keyboard shortcuts, or bulk-apply-to-many-tickets in
this pass.** The roadmap note was just "macros" — this ships the smallest
version that's actually useful (single-ticket, dropdown-triggered) rather
than speculatively building organization/shortcut features nothing has
asked for yet.

## Verified

4 automated tests (`test/macros.test.ts`): rejection of an all-empty action
set, rejection of a duplicate name, real integration through
`updateTicket`/`addMessage` (not mocked) confirming a macro's priority
change and canned reply both land correctly, and not-found handling for a
missing macro or ticket. Full suite 31/31 green.

Browser-verified end to end against the real running dev stack: created a
macro ("Escalate + acknowledge") setting priority to URGENT and adding a
canned reply, opened a real ticket that was not yet urgent, applied the
macro via the "Run macro…" dropdown in the ticket header, and confirmed
both the priority badge updated to URGENT and the canned reply appeared in
the message thread — a real round trip through `POST
/tickets/:id/apply-macro`, not a mocked assertion. Zero console errors.

## Consequences / known v1 limitations

- No macro categories or search — fine at the expected scale (a handful of
  macros per tenant); revisit if that assumption breaks.
- No bulk-apply across multiple tickets at once (list-view multi-select) —
  only the single-ticket detail-view dropdown exists.
- No usage analytics (which macros get run how often) — would be a natural
  Reporting v1 addition once that ships.
- A macro referencing a status/team/assignee that's later deleted will fail
  at apply time with whatever error `updateTicket` already raises for an
  invalid reference, rather than being proactively invalidated when the
  referenced entity is deleted. Same posture as an orphaned custom field
  reference (ADR 0006) — cheaper than a cleanup job, acceptable because
  it's an admin-triggered edge case, not a common path.
