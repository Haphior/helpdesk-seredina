# ADR 0063: Customer portal with emailed sign-in links

## Status

Accepted, implemented.

## Context

The people a helpdesk serves could email, chat through the widget, or read
the public knowledge base. They couldn't see the state of their own requests.
"Any update on my ticket?" emails are one of the biggest avoidable loads on
a support team, and the service catalog was reachable only by agents.

## Decision

### Passwordless: a one-time link by email

Contacts have no passwords, and giving them one would add a whole
credential lifecycle (reset, lockout, breach exposure) for people who sign
in a few times a year. Instead:

1. `POST /public/:slug/portal/request-link` queues an email (a new
   `contact-email` queue, sent by the worker through the tenant's first
   connected channel) with a link to `/portal/:slug/auth#<token>`.
   - The token is a 20-minute purpose-bound HMAC token (`lib/purposeToken.ts`)
     holding the tenant and email.
   - It rides in the **fragment**, so it never reaches a server log or
     `Referer`.
   - The endpoint answers `202` either way, whether or not the address has
     tickets.
   - Links are capped at 3 per address per hour (Redis counter), on top of the
     per-IP route limit, so nobody can use us to flood an inbox.
2. `POST /public/:slug/portal/redeem` trades the token for a 7-day
   **portal session**, a different purpose token with the tenant and contact.
   - Redemption is single-use across replicas (Redis `SET NX`).
   - This is also when a first-time address becomes a `Contact`: it has
     just proven it owns the mailbox.

The portal session is never a console JWT: it's signed with a
purpose-derived key, so it fails `app.authenticate`. It's also only valid on
the portal of the tenant it was issued for.

The web client (`lib/portalApi.ts`) sends only the portal session, never
the console token, even when an agent is signed in to the console in the
same browser.

### What a contact can do

Every query is scoped to `contactId` on top of RLS:

- list their tickets;
- read a ticket's **public** messages (internal notes are filtered out in the
  query itself);
- reply;
- attach a file to their **own** message;
- download attachments from the public conversation of their own tickets;
- open a ticket (`channel: 'portal'`);
- request a service catalog item.

Anything else answers `404`, the same as a missing ticket.

A reply to a CLOSED ticket reopens it and notifies the assignee, the same
behavior as a reply by email.

Agent replies on `portal` tickets are also sent by email (`addMessage`'s
`shouldEmail`), so the conversation works without revisiting the portal. The
customer's email reply threads back into the ticket like any email.

### Off by default

`Tenant.customerPortalEnabled`, toggled on **Administration → Customer
Portal**. That page warns when no mailbox is connected. A disabled portal
answers exactly like an unknown tenant (`404`).

## Consequences

- The portal needs a working email channel. Without one, links queue and
  fail in the worker, and the admin page says so up front.
- Contacts have no profile or organization view (like "all tickets from my
  company"). That's a natural extension once contacts are grouped into
  organizations.
