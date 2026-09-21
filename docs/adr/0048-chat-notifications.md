# ADR 0048: Slack and Microsoft Teams chat notifications

## Status

Accepted, implemented.

## Context

`docs/ROADMAP.md`'s Phase 4 named Slack/Teams notifications as still open, originally
framed as "one-click Connect Slack" using an OAuth app this project would register and
maintain. Per the user's explicit direction, that framing was rejected: an unfunded
open-source project has no way to responsibly carry an OAuth app through Slack's/
Microsoft's app-review process, or the ongoing maintenance burden a shared app implies
— the same reasoning already applied to Phase 5's endpoint agent (no signed installer,
no remote-execution tiers). The re-scoped version asks the tenant to bring their own
webhook URL, the same "bring your own credential" shape already proven by Telegram
(ADR 0044) and `TenantAiSettings`'s BYOK.

## Confirmed against live docs, not assumed

Both platforms' current real webhook mechanisms were checked directly before building
anything, the same rigor ADR 0039/0046 held Grafana's and Zabbix's payload shapes to:

- **Slack's "Incoming Webhooks"**: a tenant creates one from their own Slack App
  settings, workspace-internal, no app-store submission. POSTing `{"text": "..."}"` to
  the resulting URL posts that text to the configured channel — Slack's oldest,
  simplest, still-supported integration surface.
- **Microsoft Teams**: legacy "Office 365 Connectors" (the old MessageCard format) are
  being retired — Microsoft's own docs (checked live, dated 2026) say new connector
  creation "will soon be blocked." The current real mechanism is the **Workflows**
  app's "Post to a channel when a webhook request is received" template, and
  Microsoft's own documented example for it is the exact same shape as Slack's:
  `POST <WEBHOOK_URL>` with body `{"text": "Hello from a webhook workflow!"}`. Richer
  Adaptive Card payloads are also supported but not required for a plain-text message.

That both platforms converge on the identical `{"text": "..."}"` wire shape today is
what makes a single shared formatter function correct, not a coincidence papered
over.

## Approach

**One `Webhook` model, a new `kind` column** (`'generic' | 'slack' | 'teams'`,
default `'generic'`) rather than a separate model — the underlying delivery
infrastructure (`webhookDeliveryQueue`, BullMQ retry/backoff, the SSRF guard, the
`lastDeliveryAt`/`lastDeliveryStatus` bookkeeping) is entirely reused as-is; only the
outgoing payload's *content* and whether it gets HMAC-signed differ by kind.
`secretEncrypted` became nullable: a `slack`/`teams` row never has one — neither
platform's webhook has a signature-verification concept, the URL itself (generated
in the tenant's own workspace) is the only credential, the same reasoning Telegram's
`webhookSecret` header check doesn't apply here at all.

**A curated event subset for chat kinds** (`CHAT_WEBHOOK_EVENTS`:
`ticket.created`, `sla.first_response_breached`, `sla.resolution_breached`) — not
all 5 `WEBHOOK_EVENTS`. `ticket.updated`'s payload is mostly UUIDs (`statusId`,
`assigneeId`) with nothing human-readable to post without an extra lookup, and
`message.created`'s raw body could leak an internal note or a customer's own
message into a possibly-public channel without the tenant curating what's shown.
The roadmap's own original framing — "a new ticket/an SLA breach posts to a
channel" — named exactly these three scenarios; the curated set matches that
literally rather than exposing every event and hoping nobody picks a leaky one.
Enforced server-side at both create and update time (`validateEventsForKind`),
not just hidden in the UI.

**`kind` is immutable after creation.** No existing precedent in this codebase
lets a "type" field change after the fact (an `EmailChannel`/`TelegramChannel`
doesn't become a different channel type either) — deleting and recreating is the
same one action either way, and immutability keeps `updateWebhook`'s event
re-validation simple (always against the *stored* kind, never a value the request
could smuggle in).

**Delivery formatting lives in `apps/worker`, not shared with `apps/api`** —
`formatChatMessage(event, data): string` is a pure function only the worker's
`deliverWebhook` calls, plain text with an emoji prefix and no Markdown at all:
Slack's `mrkdwn` (`*bold*`) and Teams' standard Markdown (`**bold**`) disagree on
bold syntax, and a one-line notification has no real need to bet on either
dialect. `rotateWebhookSecret` now rejects a `slack`/`teams` webhook outright
(there's no secret to rotate) rather than silently generating and storing an
unused one.

## Consequences

- If a tenant wants `ticket.updated`/`message.created` notifications in Slack/Teams
  later, that needs either resolving the UUIDs into labels before formatting or a
  tenant-configurable message template — deliberately not built now, named here as
  real follow-up work rather than silently precluded (the `kind`/event-set split
  already accommodates widening `CHAT_WEBHOOK_EVENTS` later without a schema change).
- Adaptive Card / richer formatting (buttons, colored severity, etc.) is possible on
  both platforms but not built — plain text was enough to prove the real mechanism
  end-to-end and matches this project's "start simple" bias elsewhere (the CSAT
  survey's plain star-rating UI, the widget's plain conversation view).

## Verified

14 integration tests (`apps/api/test/chat-webhooks.test.ts`, live Postgres): a
slack/teams webhook has no secret, a generic webhook is unaffected, `ticket.updated`
and `message.created` are rejected for chat kinds (with the exact curated-set error
message), all three curated events are accepted together, `updateWebhook`
re-validates against the *stored* kind (not a value the request supplies), a
generic webhook's full 5-event set still works unchanged, and `rotateWebhookSecret`
correctly rejects a chat-kind webhook while still working for `generic`. Full
`apps/api` suite 282/282 green (was 272); every touched workspace typechecks and
builds clean.

Live, against the real running dev stack and a genuinely real external HTTPS
endpoint (webhook.site, not a mock) — the SSRF guard blocks private/reserved
addresses, so this is also the first real proof the guard doesn't block a
legitimate public destination: created a real tenant, created a real Slack-kind
webhook through the actual API pointing at a live webhook.site URL, created a real
ticket through the real API, and confirmed via webhook.site's own request log that
the worker delivered exactly `{"text":"🎫 New ticket #1: Printer jammed on 3rd
floor"}"` — correct emoji, correct ticket number and subject, `Content-Type:
application/json`, and (confirmed by inspecting every header webhook.site
recorded) no `X-Seredina-Signature` header, correctly omitted for a chat-kind
delivery. The webhook's own `lastDeliveryStatus` updated to `success` immediately
after. `formatChatMessage`'s output for all three curated events was independently
confirmed by direct invocation. In the browser: the new "Type" selector, the
real per-platform setup instructions (Teams' instructions match the live-checked
Workflows steps above, not guessed), and the event checkbox list narrowing to
exactly the 3 curated events when Slack/Teams is selected, all rendered correctly;
the list view shows a "Slack" badge, the real delivery's `success` status and
timestamp, and correctly hides "rotate secret" for a chat-kind row. Zero console
errors throughout.
