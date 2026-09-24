# ADR 0063: AI triage of new tickets, and a follow-up queue for new tickets

## Status

Accepted, implemented. Resolves "auto-classify" from Phase 1's deferred list.
Also fixes two gaps found along the way: tickets created from email got no
SLA clock and fired no `ticket.created` webhook.

## Context

Reply suggestions and summaries (ADR 0005) help once an agent opens a
ticket. Deciding how urgent a new ticket is and which team should take it is
the step before that. Done by hand, it's where queues pile up. The request
was an AI that does this first pass.

While wiring it up, it turned out that tickets created by **inbound email**
(created in `apps/worker`) never got SLA due dates. `computeSlaDueAts` lives
in the API's ticket service, and the worker's ingest bypassed it. They also
never fired `ticket.created`, so webhooks and Slack/Teams notifications
silently skipped the most common channel.

## Decision

### A follow-up queue for new tickets, consumed by the API

`ticket-followup` (`packages/shared/src/email.ts`) carries
`{ tenantId, ticketId, finalize }`.

- The worker enqueues `finalize: true` for every ticket it creates.
  `finalizeWorkerCreatedTicket` starts the SLA clock (idempotently, so a
  retried job can't restart it), schedules the breach checks, and fires
  `ticket.created`.
- The API's own creation paths (`createTicketFromApi` covers the API,
  widget, Telegram and catalog; `ingestAlert` covers alerts) enqueue
  `finalize: false` for triage, and only when the tenant has triage on.

The consumer is a BullMQ `Worker` **inside the API process**
(`lib/ticketFollowup.ts`), started only when the API runs as a server,
never in tests. The work needs the ticket service (SLA, webhooks) and the
AI stack (adapter selection, bring-your-own key, cost logging), all of
which live in the API. Consuming it in `apps/worker` would mean duplicating
them, which ADR 0023 specifically warns against for cost logging. BullMQ
gives each job to one API replica.

### Triage

`Tenant.aiTriageMode`: `off` (default, since every ticket costs a model
call), `suggest`, or `auto`.

The model gets the subject, the first customer message (or alert
description, capped at 4,000 characters) and the team names, and must answer
with JSON: `{priority, team, reason}`. `parseTriageReply` accepts only the
four known priorities and a team from the list offered (case-insensitive).
Anything else, including prose, is dropped. The system prompt tells the model
to treat ticket text as data, not instructions. Output is constrained to that
JSON anyway, so a prompt-injected ticket can at worst pick a wrong priority,
never do anything.

The result is stored on `Ticket.aiTriage` with its model and time, and the
call is logged as `triage` in the AI usage log.

- **suggest**: the ticket shows the suggestion with an **Apply** button
  (`POST /tickets/:id/ai/triage/apply`, `tickets:write`), applied through
  `updateTicket`, so a priority change restarts the SLA clock like any
  other.
- **auto**: applied through `updateTicket` too, but **only to fields still at
  their default**: priority `NORMAL` and no team. A priority chosen on a
  catalog form, mapped from an alert's severity, or sent by an API caller is
  never overwritten. An internal AI-authored note says what changed and why.

Triage runs once per ticket: a ticket that already has a result is
skipped.

## Consequences

- Triage and email finalization need the API running. In every supported
  deployment it is. If the API is down, jobs wait in Redis and run when it's
  back.
- Only priority and team for now. Tags and categories don't exist as ticket
  fields, and custom fields vary per tenant, so they're left out.
