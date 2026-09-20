# ADR 0044: Telegram channel

## Status

Accepted, implemented.

## Context

`docs/ROADMAP.md`'s Phase 4 named "WhatsApp/Telegram/Slack/Teams/Zabbix integrations" as
still open. Of those, Slack/Teams both require registering a real OAuth app with that
platform before any code here can be exercised end-to-end — a real external blocker,
not something to build blind. Telegram has no such blocker: a tenant creates a bot
themselves via `@BotFather` and gets a bearer token immediately, so this is the
well-scoped item to pick up next. WhatsApp's Business API requires Meta Business
verification and template-message approval — a much heavier lift, still open.

## Approach

**Storage — `TelegramChannel`, one row per tenant** (unlike `EmailChannel`, which
allows several): `botUsername` (denormalized from Telegram's own `getMe`, for
display), `botTokenEncrypted` (AES-256-GCM, the exact `EmailChannel`-password
pattern), and `webhookId`/`webhookSecret` — see "Webhook security" below.

**Connecting** (`PATCH /telegram-channel`, `channels:manage`) validates the token
live against Telegram's own `getMe` — a bad or revoked token fails right there with
Telegram's real error message, not discovered later on the first inbound message —
then calls `setWebhook` so Telegram starts pushing this tenant's messages to us. No
separate "paste this URL into Telegram" step (unlike the Grafana integration, ADR
0039): Telegram's Bot API lets us register the webhook ourselves, which is simpler
for the tenant and only possible because Telegram (unlike a tenant's own monitoring
tool) has one fixed, documented API we call directly.

**Webhook security — two independent, unguessable values, not one.** Telegram's
webhook config supports exactly one custom auth mechanism: a `secret_token` set at
`setWebhook` time, echoed back on every call via the `X-Telegram-Bot-Api-Secret-Token`
header. There is no way to send a custom `Authorization` header the way Grafana's
webhook contact point can (so the existing `ApiKey`-auth pattern doesn't drop in
here). The design: `webhookId` (in the URL path, `POST /v1/integrations/telegram/
webhook/:webhookId`) routes an incoming call to a tenant with no tenant context yet —
resolved via `resolve_tenant_id_by_telegram_webhook`, a `SECURITY DEFINER` Postgres
function exposing only `tenant_id`, the same shape as `resolve_tenant_id_by_api_key_
hash` — and `webhookSecret` (checked against that tenant's own stored value) is the
second, independent check. Leaking a webhook URL alone (e.g. from a log) isn't
enough to inject fake messages into that tenant's queue; the same "two things must
both be known" reasoning as the widget channel's own bearer token (ADR 0040).

**Threading — reusing `Ticket.externalId`, not a new column.** A Telegram
conversation's chat id plays exactly the role alert's own event id already plays
(ADR 0003): `handleTelegramUpdate` looks up an existing ticket with `channel:
'telegram', externalId: chatId, status.category != CLOSED` and folds a follow-up
message into it via `addMessage`; no match (first message, or the previous ticket
for that chat was since closed) creates a fresh ticket via `createTicketFromApi`.
Both `createTicketFromApi` and `Ticket.externalId` grew one generic concept
(`externalId?: string`, same as `widgetToken` already does) rather than Telegram
inventing a parallel field — the field's own schema comment was broadened to name
both real users now that there are two, not just alert's.

**Contact identity.** `Contact.email` is the tenant-unique key every channel already
upserts against; a Telegram chat has no email. Rather than adding a second identity
column to `Contact` for one channel, a stable pseudo-email is synthesized:
`telegram-<chatId>@telegram.local` — obviously not a real address, but a real,
stable, tenant-unique key that reuses the existing upsert path with zero `Contact`
schema change. Display name falls back through first+last name → `@username` →
`Telegram user <chatId>`, in that order.

**Scope cut, named not silent: text messages only.** A non-text update (photo,
sticker, an edited message, ...) is acknowledged with `200 OK` (so Telegram doesn't
retry) and otherwise ignored by `handleTelegramUpdate`. A real, separate feature for
a later pass, not attempted here.

**Outbound — the exact `EmailChannel` shape, not a new mechanism.** `addMessage`
already had `shouldEmail` (a public, non-private reply on a `channel: 'email'`
ticket enqueues an SMTP send); `shouldTelegram` is the same shape for `channel:
'telegram'`, enqueuing `telegramSendQueue` (BullMQ, mirroring `emailSendQueue`
exactly) for `apps/worker` to actually call `sendMessage`.

**Where the Telegram Bot API client itself lives**: `packages/shared`, not
`apps/api` — `apps/worker` needs it too (the outbound `sendMessage` call), so one
implementation is shared rather than risking two drifting apart, the same reasoning
`@seredina/db`'s `resolveTenantIdByApiKeyHash` already established for `apps/mcp-
server`. It's raw `fetch` against `https://api.telegram.org`, no SDK — confirmed
live against the real API (a bad token really does come back as `{ok:false,
error_code,description}`) rather than assumed from docs alone.

## A real bug found live, not by the automated suite

`addMessage`'s original `shouldTelegram`/`shouldEmail` checks were `ticket.channel
=== '...' && !input.isPrivateNote` — no `authorType` check. `handleTelegramUpdate`
calls `addMessage` with `authorType: 'CONTACT'` for a customer's own follow-up
message (the same call the widget channel already makes for its own follow-ups —
ADR 0040). Without an `authorType` guard, a Telegram user's second message would
have enqueued a real outbound send **of their own message, back to themselves**.
This never manifested for the widget channel by coincidence, not by design: a
widget ticket's `channel` is `'widget'`, which never matches either check — the bug
was latent in `addMessage`'s shape from the moment the widget channel started
calling it with `authorType: 'CONTACT'`, just never triggered because no channel's
outbound condition happened to match `'widget'`. Telegram is the first channel
where a customer's own follow-up and an outbound-send condition actually collide.

Caught live in this session's dev environment, not in the test suite first: the
already-running worker process picked up two real `telegram-send` jobs and logged
`no Telegram channel configured for this tenant` while `apps/api/test/telegram-
channel.test.ts` was being run, which was the first sign something was enqueuing
that shouldn't have been. Fixed by adding `authorType !== 'CONTACT'` to both
`shouldEmail` and `shouldTelegram` (mirroring the identical guard the adjacent
`firstRespondedAt` check already uses two lines above, for the exact same reason).
A regression test (`does not enqueue an outbound telegram-send job for the
customer's own follow-up message`) spies on `telegramSendQueue.add` rather than
inspecting real Redis job counts — this suite runs against a real, shared Redis
that a live worker may also be consuming from, so asserting on job counts directly
would race an already-running consumer.

## Consequences

- `shouldEmail`'s own latent version of this bug was never reachable (email's
  inbound polling writes a CONTACT follow-up via a direct `tx.message.create`,
  never through `addMessage`) — but the fix applies the same guard there too,
  defensively, rather than leaving a trap for whenever that changes.
- New required-when-used env var `API_PUBLIC_URL` (`.env.example`) — connecting a
  bot fails closed with a clear message if unset, rather than silently registering
  a broken localhost webhook Telegram could never reach.

## Verified

16 integration tests (`apps/api/test/telegram-channel.test.ts`, live Postgres;
Telegram's own Bot API mocked at the one real external-network boundary,
`callTelegramApi`, the same "don't call a real paid/rate-limited third party in the
automated suite" posture as `TestProviderAdapter` for the AI adapters): connect
validates via `getMe` and registers a webhook, GET reflects the connection,
connecting without `API_PUBLIC_URL` or with a token Telegram itself rejects both
fail closed, disconnect calls `deleteWebhook` and removes the row (best-effort even
if Telegram's own call fails), the webhook-id/secret resolve-and-verify pair works
end to end, an unknown webhook id resolves to no tenant, RLS isolation between two
tenants, the full `handleTelegramUpdate` matrix (new ticket, same-chat fold, fresh
ticket after close, non-text ignored, two chats stay independent, username
fallback), and the `shouldTelegram` regression above. Full `apps/api` suite
250/250 green (was 234); every touched workspace (`packages/shared`, `packages/db`,
`apps/api`, `apps/worker`, `apps/web`) typechecks and builds clean.

Live, against the real running dev stack and the real Telegram API (not just
mocked in tests): registered a tenant, attempted to connect with a garbage token
through the actual Settings UI, and confirmed Telegram's own real rejection
(`Unauthorized`) surfaced correctly in the browser. Seeded a `TelegramChannel` row
directly (a real bot token requires a human's own Telegram account to obtain via
`@BotFather` — not something this session can generate) and `curl`-posted a
synthetic Telegram Update to the real, running `/v1/integrations/telegram/webhook/
:webhookId` route: correct payloads produce a real ticket (confirmed via Playwright
screenshot — contact name, synthesized email, `telegram` channel badge, and the
chat id rendered as the ticket's `ref:`), a wrong secret header is rejected `401`,
and an unknown `webhookId` is rejected `404`. Replied as an agent through the real
UI and confirmed via the worker's own log that it picked up the job, decrypted the
stored token, and called Telegram's real `sendMessage` endpoint — which correctly
rejected it as `Unauthorized` since the seeded token isn't a real bot's. **Known,
disclosed gap**: actual message delivery to a real Telegram user/bot could not be
verified in this sandbox, since that requires a bot token only a human can obtain;
every other part of the pipeline (webhook security, threading, contact identity,
outbound enqueue-and-attempt) was verified against the real Telegram API and the
real running dev stack, not just unit-tested in isolation.
