# ADR 0066: Contact data rights: export, correction, anonymization and retention

## Status

Accepted, implemented.

## Context

A helpdesk stores personal data about the people who write in: their name
and email, and whatever they put in their messages (phone numbers, national
ID numbers, screenshots). Contacts had no page of their own and could only
be reached through a ticket. Nothing could correct them, give them a copy of
their data, or erase it.

Data protection law gives people those rights. Chile's Ley 21.719 applies
from December 2026 (access, rectification, erasure, portability), as do
GDPR, Brazil's LGPD and others. A self-hosted operator using Seredina needs a
way to honor them without writing SQL.

## Decision

### A Contacts page

`/contacts` lists and searches contacts (anyone with `tickets:read`), and
`/contacts/:id` shows one with their tickets. The ticket page links to it.

A new permission, **`contacts:manage`**, covers everything that changes or
releases a contact's data. It's granted to existing admin roles by the
migration.

### Access and portability: an export

`GET /contacts/:id/export` returns one JSON file with:
- the contact;
- their tickets, with custom fields, the satisfaction rating and comment;
- the messages, with attachment names and sizes.

Internal notes are left out unless `?internalNotes=true`. They're the team's
working notes, so an admin should read them before handing them over.

### Rectification

`PATCH /contacts/:id` changes the name or email. An address another contact
already has is refused (409).

### Erasure: anonymize, don't delete

`POST /contacts/:id/anonymize` needs the contact's email typed back as
confirmation, and can't be undone. It runs `anonymizeContactInTx`
(`packages/db/src/contactErasure.ts`), shared with the worker so both erase
exactly the same things.

What goes:
- the name and email: replaced by "Anonymized contact" and
  `anonymized-<id>@anonymized.invalid` (`.invalid` can never receive mail);
- on every one of their tickets:
  - the subject;
  - **every message body**, including agent replies and internal notes,
    which quote the customer too;
  - Message-IDs, attachments, custom field values and AI triage reasoning;
  - the satisfaction comment;
  - AI agent tool arguments and results;
  - the widget token and external id;
  - the in-app notifications about those tickets.

What stays: the tickets as empty records, meaning their number, status,
priority, team, assignee, channel, dates, SLA timestamps and satisfaction
rating. Deleting the tickets would silently change every past report,
SLA figure and CSAT average. The empty records hold nothing that
identifies anyone.

If the same address writes in again, a fresh contact is created.

### Retention: automatic anonymization, off by default

`tenants.contact_retention_days` (30 to 3650, null = off) is set from the
Contacts page. Every six hours the worker asks
`list_contacts_due_for_retention()`. That is a `SECURITY DEFINER` function
returning `(id, tenant_id)` only, the same escape hatch as the other
cross-tenant jobs. It finds contacts that meet all of these:
- the tenant has retention on;
- the contact isn't anonymized yet;
- no open (non-resolved, non-closed) ticket;
- no contact, ticket or message activity inside the window.

The worker anonymizes each one the same way, at most 500 per run, under a
Redis lock.

### The audit log

- Exports, corrections, anonymizations and retention changes are all audited.
- Retention runs are recorded as `system` / "retention policy", in the same
  transaction as the erasure.
- **Audit entries name the contact by id only.** The audit log is append-only
  (ADR 0060), so a name or email written there would outlive the erasure.

## Consequences

- Backups keep the data until they rotate out. The backup guide says so,
  and so does this ADR. Webhook payloads and emails already delivered
  elsewhere are outside Seredina.
- The Redis `contact-email` queue briefly holds addresses for portal links,
  as before. Completed jobs are removed by BullMQ's normal limits.
- Knowledge base articles an agent wrote from a ticket aren't touched. They
  are the team's own content.
- Console users (agents, admins) are a different record, `User`. They're
  deactivated, not anonymized. That's out of scope here.
