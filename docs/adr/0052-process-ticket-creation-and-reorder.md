# ADR 0052: Process step ticket creation, and drag-reorder template steps

## Status

Accepted, implemented.

## Context

User feedback on the "Processes" feature: "Procesos es util pero me gustaria
que fuera más facil configurarlos, y crear tickets para esos procesos
asignados a un usuario" — processes are useful, but (a) configuring a
template should be easier, and (b) it should be possible to create a ticket
tied to a process step, assigned to a user.

(b) was a documented, deliberate gap: ADR 0008 shipped `ProcessStepInstance
.ticketId` and a `PATCH /process-steps/:id` endpoint that can *link* an
existing ticket, explicitly deferring the picker/creation UI as real
additional scope. `getProcessInstance` already fetched `step.ticket` for
every step; nothing rendered it.

## Approach

**Creating a ticket from a step, not auto-spawning one.** The schema has no
"current/active step" concept — every `ProcessStepInstance` row exists from
instance creation and is updated independently (only `sortOrder` orders them
for display). Inventing an activation trigger ("when does step N become
current?") to auto-spawn a ticket would require a real state-machine design
this feature doesn't have and wasn't asked for. Instead: a "+ Create ticket"
action on each step card opens a small form (subject, description, requester
name/email, priority, assignee) and calls a new endpoint,
`POST /process-steps/:id/create-ticket`. A human decides when a step needs
real ticketed work, same as they already decide when to change a step's
status — this stays consistent with how every other step field already
behaves (agent-driven, not automatic), and is the simpler, more predictable
design.

**Reuses `createTicketFromApi`**, the same function `POST /tickets`
(the console's own "New ticket" button) already calls with `channel:
'agent'` — not a new ticket-creation path. Its `CreateTicketFromApiInput`
gained one new optional field, `assigneeId`, so the ticket can be assigned
atomically at creation instead of a follow-up `PATCH` (which would leave a
window where the ticket exists but isn't yet assigned, and risks a partial
failure). Every other caller (API/alert/widget/catalog/telegram channels)
never passes it, so their behavior is byte-for-byte unchanged.

`createTicketForProcessStep` (processes/service.ts) rejects a step that
already has a linked ticket (`ticketId` set) — one ticket per step, matching
the schema's own `ticketId?` (singular, not a list). After creating the
ticket, it calls the existing `updateProcessStep` to link `ticketId` and,
only if an assignee was actually chosen, mirror it onto the step's own
`assigneeId` — omitting the key entirely (not passing `null`) when no
assignee was given, so a step that already had an assignee set manually
before the ticket existed keeps it.

**"Link existing ticket"** stays available alongside "Create ticket" (a
plain `<select>` of open tickets, same shape as `TicketDetail.tsx`'s
existing merge-into picker) — for the case where the ticket already exists
and just needs linking, the exact capability ADR 0008 shipped and left
unrendered.

**Easier template configuration**: native HTML5 drag-and-drop step
reordering plus a "duplicate step" button in `ProcessTemplates.tsx`'s
`TemplateModal` — no library, same pattern as the dashboard-builder's widget
reorder (`docs/adr/`'s dashboard-builder entry). No backend change was
needed for this half: `createProcessTemplate`/`updateProcessTemplate`
already take steps as an ordered array and assign `sortOrder` from array
index, so reordering client-side and resubmitting already worked — the gap
was purely that the UI offered no way to reorder except delete-and-retype.

## Consequences

- An agent can now go from "this step needs real IT work" to a
  ticket-in-progress in one modal, instead of leaving the console entirely.
- Per-step auto-ticket-creation (triggered by a step becoming "current")
  remains explicitly out of scope until this product has an actual
  active-step concept to hook into; documented here so it isn't quietly
  assumed to already exist.
- Template authoring is still a flat form, not a full wizard — reorder and
  duplicate close the two friction points found in practice; a guided
  multi-page wizard remains a possible future pass, not built here.
