# ADR 0003: Alert ingestion reuses Ticket, not a new Incident model

## Status

Accepted, implemented.

## Context

The NOC/SOC scoping decision (see `docs/ROADMAP.md`'s "Vision expansion" section)
settled on integration, not native monitoring/SIEM: an external tool posts an alert,
Seredina turns it into something an agent works. `docs/adr/0002-agentless-discovery.md`
left the data model for that explicitly undecided — "a `Ticket` (or a new lighter-weight
`Incident` type, undecided)". This ADR resolves it.

## Decision

**Reuse `Ticket`.** A new `Incident` model was considered and rejected: the lifecycle
an alert actually needs — arrives, gets triaged, gets assigned, gets worked, gets
resolved, gets closed, with a message thread recording what happened along the way —
is identical to a support ticket's lifecycle. Every mechanism that already exists for
it (RBAC via `tickets:*` permissions, `TicketStatusCategory`-driven
`resolvedAt`/`closedAt` stamping, assignment, team routing, the web UI) would need to
be either duplicated for `Incident` or awkwardly shared via an abstraction built
before there's a second real use case for it. A separate model earns its cost only
when the lifecycle genuinely diverges — it doesn't here.

Concretely, alert-originated tickets are regular `Ticket` rows distinguished by:
- `channel: 'alert'` (alongside the existing `'api'`) — this was already the
  mechanism for "how did this ticket come to exist," so alerts fit it directly
  rather than needing a new field.
- `externalId` (new nullable column on `Ticket`) — the source tool's own id for the
  problem (a Zabbix event id, a Wazuh alert id, ...), used only for deduplication
  (below), not a general-purpose field.
- A synthetic `Contact` per alert source (`{source}@alerts.local`) rather than no
  contact at all — `Ticket.contactId` is required, and inventing a nullable-contact
  code path across every ticket query/permission check for this one case was judged
  not worth it versus a synthetic contact that reads sensibly in the UI ("Zabbix"
  as the requester is honest about where the ticket came from).

**Deduplication is a service-layer lookup, not a DB constraint.** `ingestAlert()`
(`apps/api/src/modules/tickets/service.ts`) checks for an existing ticket with the
same `(tenantId, channel: 'alert', externalId)` whose status category isn't
`CLOSED`; if found, the new alert becomes a message on that ticket instead of a new
one. A `CLOSED` ticket with the same `externalId` legitimately gets a fresh ticket —
whatever was wrong was declared resolved, so a new occurrence is a new incident, not
a reopening. This can't be a simple unique DB constraint because "duplicate" is
conditional on the existing ticket's current status, not just matching IDs.

**Severity is a normalized 5-value scale** (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`INFO`
→ `TicketPriority`), not any specific tool's native scheme. Mapping a tool's own
severity (Zabbix's "Disaster".."Not classified", Wazuh's numeric 0-15 rule levels,
...) into this is the integrator's job — e.g. a Zabbix webhook media type script
translates before POSTing. Keeps the ingestion contract tool-agnostic, consistent
with the "integrate, don't build vendor-specific support" scoping decision.

**Same `ApiKey` auth as `POST /v1/tickets`, no separate credential type.** A
customer's monitoring tool and their generic ticket-creation integration both just
need an API key — this was already true of the API channel's design, extending it to
alerts avoided inventing a second auth/credential concept for what's functionally
the same trust boundary (an external system authorized to create tickets in this
tenant).

## Consequences

- Reporting/filtering that wants to treat "alerts" differently from "support
  requests" filters on `channel`, same as it will eventually for `'email'`/`'widget'`
  — no new query shape needed.
- If a genuinely alert-specific need emerges later that doesn't fit Ticket's shape
  (e.g. auto-correlation across multiple alerts into one incident, a formal
  postmortem workflow) that's a real signal to revisit this decision — not
  preemptively guarded against now.
- The synthetic per-source contact means alert volume from one tool accumulates
  under one `Contact` row indefinitely; this is intended (it's not a real person to
  paginate/search among) but worth knowing if `Contact` listings are ever built
  without filtering out `@alerts.local` addresses.
