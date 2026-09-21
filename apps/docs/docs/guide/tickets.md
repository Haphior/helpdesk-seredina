# Tickets

## The ticket queue

**Tickets** in the sidebar is the screen an agent uses the most. It has
five tabs by status category (All, Open, Pending, Resolved, Closed), a
free-text search box, and filters by assignee (including an "Assigned to
me" shortcut) and priority.

### Saved views

Any combination of tab + filters can be saved with **+ Save this view** —
it appears as a pill above the table, in the same bar as the filters, and
can be removed with the × without deleting the tickets it represents.

### Selection and bulk actions

With ticket-write permission, every row has a checkbox. Selecting several
shows a bar with three actions: assign, change status, or change
priority — applied to every selected ticket at once. It's a UI layer over
the same individual update endpoint, not a separate backend route.

### Creating a ticket by hand

**New ticket** opens a modal with two modes:

- **Blank ticket** — for a case that came in by phone or in person:
  subject, description, requester details, priority.
- **From catalog** — if your tenant has items configured in the
  [Service Catalog](/guide/service-catalog), pick one and the form builds
  itself from its associated custom fields.

If no catalog items are configured, the modal starts directly in "blank"
mode.

## Ticket detail

### Header

Status, priority, and channel as badges; an indicator if the first
response or resolution is overdue against the applicable SLA (see
[SLA & Escalation](/guide/sla-and-escalation)); and, if more than one
agent is looking at the same ticket at once, an "Also viewing:" notice
with their names — so two people don't answer the same thing without
knowing it.

### Actions on the ticket

- **Merge into…** — moves every message from this ticket onto another and
  closes this one with a note pointing at the destination. Useful when
  the same problem generated two separate tickets.
- **Run macro…** (if macros are configured) — applies a predefined set of
  changes at once (change status, assign, add a reply) from
  **Configuration → Macros**.
- **Summarize** / **Let AI try** — see [AI Copilot](/guide/ai-copilot).

### Messages and replies

The thread shows every message with its author and time. A message marked
as **Internal note** has an amber background and is never visible to the
contact — it's for coordination between agents. Any reply can carry file
attachments.

### The properties panel

On the right: status, priority, team, assignee, and the linked problem
(if any) — all editable inline, no separate form to open. Below that, if
the ticket has a first-response or resolution deadline, it shows when it
was met or when it's due.

If your tenant has
[custom fields](/guide/administration#custom-fields)
configured, they appear in the same panel — the field type (text,
number, yes/no, date, or a list of options) determines the control shown.

Further down, the contact's details, and any linked CMDB assets — with
the option to link a new one from a dropdown, and see which real services
are affected if that asset has associated services.
