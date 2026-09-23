# ADR 0056: Inbound email attachments and replying from the right mailbox

## Status

Accepted, implemented.

## Context

Two gaps in the email channel (ADR 0004), both called out as deferred in the
roadmap:

- `mailparser` parsed the attachments of every inbound email, and the worker
  then dropped them. A customer who emailed a screenshot or a log file lost
  it, even though manual uploads (ADR 0026) already had a model, storage and
  a download route.
- A ticket didn't remember which mailbox it arrived on. Replies went out
  through the tenant's first active channel. With two mailboxes (for example
  `soporte@` and `facturacion@`), the customer got the answer from the wrong
  address.

## Decision

### Attachments

The worker stores inbound attachments as `Attachment` rows on the new
message, in the same transaction, with the **same caps as a manual upload**:
8 MB per file and 5 per message. The constants moved to
`packages/shared/src/attachments.ts` so the API and the worker can't drift.

`selectInboundAttachments` puts real attachments ahead of inline images, so a
signature logo can't use up a slot the customer's actual file needed. It also
never drops anything silently: a file that is too big, or a real attachment
past the fifth, is named in a note appended to the message body. Inline images
past the cap are skipped without a note, because they're almost always
signature logos.

The download route already serves every attachment with
`Content-Disposition: attachment` (plus helmet's `nosniff`), which matters
now that the files come from outside senders rather than logged-in agents.

### Mailbox per ticket

`Ticket.emailChannelId` (nullable, `ON DELETE SET NULL`) is set when an email
creates a ticket. It's also backfilled when a reply lands on a ticket that
has no channel yet, such as an older ticket. The reply sender and
notification sender both use `pickSendChannel`: the ticket's channel if it's
still connected, otherwise the first connected one.

## Consequences

- Attachment bytes keep living in Postgres. The per-file and per-message caps
  bound the growth. Object storage stays the answer if volume ever
  justifies it.
- Outbound replies still don't carry the agent's attachments. Uploads happen
  after the message is created, one request per file, so the send job would
  race them. Carrying them would mean waiting for uploads to finish before
  enqueueing the send.
