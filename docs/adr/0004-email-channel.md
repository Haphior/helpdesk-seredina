# ADR 0004: Email channel — IMAP polling, SMTP sending, Message-ID threading

## Status

Accepted, implemented.

## Context

Phase 1 shipped the API channel and left email explicitly deferred ("needs real mail
credentials to build against meaningfully"). This pass builds it, verified against a
real SMTP+IMAP server (Greenmail, a test mail server) rather than mocked — several of
the decisions below came directly out of things that failed against a real server
and wouldn't have been caught testing against a mock.

## Decisions

**Inbound is a plain interval loop across every tenant's channels, not a per-channel
BullMQ repeatable job.** BullMQ supports scheduling recurring jobs, but registering/
deregistering one in step with `EmailChannel` create/update/delete is real
bookkeeping complexity this v1 doesn't need with a single worker instance — the
worker just wakes up every `EMAIL_POLL_INTERVAL_MS` (default 30s) and polls whatever
channels are currently active. **Known consequence, not an oversight**: running
multiple worker replicas would double-poll every mailbox. Only a real problem once
horizontal scaling matters (Phase 4); revisit with a proper distributed scheduler
(or move to per-channel BullMQ repeatable jobs) then, not preemptively.

**A `SECURITY DEFINER` function (`list_active_email_channels()`) for cross-tenant
discovery**, same pattern as `resolve_tenant_id`/`resolve_tenant_id_by_api_key_hash`
(`docs/adr/0001-multi-tenancy-rls.md`). The worker genuinely needs to discover *which*
tenants have active channels — it can't be handed a tenant id up front the way a
request-scoped operation can. The function exposes only `(id, tenant_id)`, never
credentials; each channel's full row (including the still-encrypted password) is
fetched afterward through the normal tenant-scoped `withTenantTx` path, so encrypted
credentials never pass through a SECURITY DEFINER context.

**Passwords are encrypted (AES-256-GCM), not hashed.** Unlike `User.passwordHash`
(bcrypt, one-way — we only ever need to verify a login, never recover the password)
or `ApiKey.hashedKey` (SHA-256, exact-match only), the worker needs the *real* IMAP/
SMTP password back to authenticate to the mail server. This is the one place in the
schema that needs a genuinely recoverable secret. `ENCRYPTION_KEY` (64 hex chars, 32
bytes) is an operator-supplied env var, not stored in the database — losing/rotating
it makes every already-stored channel password undecryptable, same trade-off as
losing `JWT_SECRET` invalidates every session.

**Threading matches In-Reply-To/References against a stored `Message.externalId`**
(the email `Message-ID` header) — the exact same shape as `Ticket.externalId` drives
alert deduplication (`docs/adr/0003-alert-ingestion.md`), reused here at the
`Message` level since email threading is about which *message* a reply continues,
not which *ticket* (a ticket can have many inbound messages, each with its own
Message-ID). Both inbound and outbound messages get an `externalId`: inbound, it's
whatever the sending mail client generated; outbound, Seredina mints one
(`<{message.id}@seredina>`) specifically so that if the customer replies to *that*
email, the same matching logic finds it.

**A reply to a closed ticket's thread reopens it; this deliberately differs from
alert ingestion's dedup**, where a re-fired alert for a closed ticket gets a *new*
ticket. The two situations aren't the same shape: an alert re-firing is a new
occurrence of a recurring problem (the old incident really is over), while a
customer replying to an old email thread is unambiguously the same conversation
continuing — reopening is what any human would expect, and what most helpdesk tools
do.

**A `<span>`-wrapping-`<input>`/`<select>` pattern in forms broke Playwright's
`getByLabel()`** during verification (unrelated to email specifically, but
discovered while building this feature's settings form) — not fixed, since the
existing `AssetFormModal`/`Users` forms already use the same pattern successfully in
their own tests via positional (`nth()`) or `role="dialog"`-scoped locators instead.
Noted here only so a future session doesn't waste time assuming `getByLabel` will
work against this codebase's form components without checking first.

## What failed against a real server (and why testing against Greenmail, not a mock,
mattered)

Issuing a `STORE` command (`messageFlagsAdd`, to mark a message `\Seen`) **while a
multi-message `FETCH`'s untagged responses were still streaming on the same
connection hung indefinitely** against Greenmail. This is not documented failure
behavior for imapflow or a known IMAP protocol restriction we could have looked up —
it was found by running the real polling loop against a real IMAP server and it
hanging past a 30-second timeout, then bisecting with a minimal reproduction script
down to the exact call. Fixed by collecting processed UIDs during the `for await`
loop and issuing **one** batched `messageFlagsAdd` after the loop fully drains,
never interleaved with an in-flight `FETCH` (`apps/worker/src/email/poll.ts`). A
mocked IMAP client would almost certainly not have reproduced this, since the bug is
specifically about connection-level command interleaving timing, not IMAP semantics
a mock would typically model.

## Verified end to end (real SMTP+IMAP, not mocked)

Using Greenmail (`greenmail/standalone` Docker image) as both the customer's and the
support mailbox's real mail server: sent an email as an external customer → the
worker's poll loop created a `Ticket` (`channel: 'email'`) with the correct subject/
body/contact → replied as an agent through the actual API → confirmed the reply was
automatically enqueued and sent via the real `email-send` BullMQ worker (no manual
triggering) → connected via IMAP as the customer and confirmed the reply arrived with
correct `In-Reply-To`/`References` headers pointing at the original message →
replied again as the customer *to that email* and confirmed it threaded onto the
same ticket as a new message, not a new ticket → closed the ticket → sent one more
threaded reply and confirmed the ticket reopened automatically. Browser-verified the
`/email-channels` settings page (create, list, `lastPolledAt` updating from the real
background poll loop) and the full rendered conversation thread, zero console errors.

## Consequences / known v1 limitations

- A ticket doesn't remember *which* `EmailChannel` it arrived through — outbound
  send picks the tenant's first active channel. Fine while one channel per tenant is
  the expectation; needs a real `Ticket.emailChannelId` link before multiple
  channels per tenant are meaningfully supported.
- No attachment handling — `mailparser` extracts them, but nothing stores or
  surfaces them yet.
- No SPF/DKIM/DMARC guidance surfaced to operators; deliverability of outbound mail
  is entirely the operator's own mail server's problem, undocumented here beyond
  this note.
- Multiple worker replicas double-poll every mailbox (see the interval-loop
  decision above) — a real constraint on horizontal scaling, deferred to Phase 4.
