# ADR 0016: Service Catalog — a template that calls the existing ticket-creation path

## Status

Accepted, implemented.

## Context

From the competitive pass against Jira Service Management, GLPI, and
ManageEngine ServiceDesk Plus (docs/ROADMAP.md): a tenant-defined list of
*requestable things* ("new laptop," "VPN access," "onboard a contractor"),
each pointing at its own form. ADR 0006 (custom fields) already flagged the
gap this fills: "no drag-and-drop `TicketForm` layout customization... a
separate, larger GLPI-parity item."

## Decisions

**`ServiceCatalogItem` is a template, not a form-builder.** It's deliberately
thin: `name`, `description`, `icon`, and `customFieldKeys` (which of the
tenant's already-defined `CustomFieldDefinition`s to ask for). No layout,
ordering, or grouping controls, no conditional fields — the roadmap note's
own phrasing ("no drag-and-drop `TicketForm` layout customization... a
separate, larger GLPI-parity item") stays true after this ADR; a full form
builder is still explicitly out of scope, deferred until real usage shows
it's needed.

**`customFieldKeys: String[]` references `CustomFieldDefinition.key`, not
`id`.** Same posture `Ticket.customFields` already takes: a key whose
definition is later deleted is simply never rendered, not a dangling FK that
needs cleanup. Keeps `ServiceCatalogItem` decoupled from `CustomFieldDefinition`
lifecycle — deleting a custom field never has to cascade into every catalog
item that referenced it.

**Requesting an item calls the existing `createTicketFromApi`, not a new
ticket-creation implementation.** This is the load-bearing reuse decision the
roadmap note called for directly ("the same creation path every other channel
already uses"). `createTicketFromApi` gained two new optional fields —
`channel` (defaults to `'api'`, so the existing `/v1/tickets` behavior is
unchanged) and `customFields` — rather than being duplicated. The synthetic
first message body (`Requested: <item.name>` plus the item's description) and
the requester's contact info flow through the exact same
find-or-create-contact, SLA-due-date, and webhook-dispatch logic every other
ticket already gets. `channel: 'catalog'` is the only new distinguishing
value on `Ticket.channel`.

**A blank subject falls back to the item's name, not an empty ticket
subject** — `input.subject?.trim() || item.name`. Making the subject
optional in the request form keeps the common case ("just give me a laptop")
to three fields (requester name, email, and whatever custom fields the item
asks for) without ever producing an untitled ticket.

**No enforcement that a `CustomFieldDefinition` marked `required` is actually
filled in when requesting a catalog item** — consistent with ADR 0006's
existing stance that `required` is UI-only, not a server-side constraint.
Not a new scope cut, just this feature inheriting one already made.

**This also became the first agent-facing manual ticket-creation path.**
Before this, a ticket could only be created via `/v1/tickets` (an external
API key) or the email channel — an agent had no way to create one directly
from the console. Rather than building a separate generic "blank ticket"
form (out of scope for this roadmap item), the Service Catalog's request flow
doubles as that path: the "New ticket" button on the Tickets queue page opens
the catalog request modal directly. A tenant with an empty catalog sees a
message pointing at the Service Catalog admin page rather than a broken
flow.

**Permission tiers mirror Custom Fields exactly**: browsing/requesting
(`tickets:read` to list, `tickets:write` to request — day-to-day actions) vs.
defining/deleting items (`tickets:manage_all` — tenant-wide configuration).

## Verified

6 new integration tests against real Postgres
(`apps/api/test/servicecatalog.test.ts`): creating an item rejects a
duplicate name; successive items get increasing `sortOrder`; requesting an
item creates a ticket on the `catalog` channel with the requester upserted as
its contact and the given custom fields stored; an explicit subject overrides
the item's name while a blank one falls back to it; requesting a nonexistent
item is rejected; deleting an item works and a second delete is rejected.
Full suite 58/58 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean.

Browser-verified end to end against the real running app: created a custom
field, created a catalog item with an icon, description, and that field
attached, clicked "New ticket" from the Tickets queue, picked the item, filled
in the requester's name/email and the custom field, submitted, and landed
directly on the new ticket's detail page — confirmed the subject, the
`catalog` channel badge, the synthesized first message body, the contact, and
the custom field value all render correctly, then confirmed the item still
lists correctly back on the Service Catalog admin page. Zero console errors.

## Consequences / known v1 limitations

- No self-service portal — a contact still can't submit a catalog request
  themselves; only an agent can, on their behalf. That's its own
  already-listed roadmap item ("Self-service portal + a browsable knowledge
  base") and a natural place to reuse this same request endpoint later behind
  contact-facing auth instead of an agent JWT.
- No form layout/ordering/conditional-fields builder, as noted above —
  `customFieldKeys` renders in whatever order the tenant's custom fields
  happen to be defined.
- No default team/priority/assignee per catalog item — every catalog ticket
  lands in the same "open, unassigned, normal priority" state as any other
  new ticket; a future pass could add per-item defaults if real usage shows
  it's needed (e.g. routing all "New laptop" requests to an IT team).
