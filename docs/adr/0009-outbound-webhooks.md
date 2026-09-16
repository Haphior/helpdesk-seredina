# ADR 0009: Outbound webhooks — HMAC-signed, https-only, SSRF-guarded

## Status

Accepted, implemented. The concrete first piece of the contract-based
extension model recommended in the Phase 2 roadmap note (webhooks + API keys +
the planned MCP server, instead of a native code-loading plugin system).

## Context

The opposite direction from everything built so far: `POST /v1/tickets` and
`POST /v1/alerts` are something external notifying Seredina; this is Seredina
notifying something external when a ticket or message event happens. The
obvious naive version — store a URL, POST to it — has three real problems for
a multi-tenant product that a self-hosted-only tool could get away with
ignoring: the receiver needs to verify the payload actually came from
Seredina, a tenant-supplied URL is untrusted input that could point at
internal infrastructure, and a slow/down receiver can't be allowed to block
anything.

## Decisions

**Secret is server-generated and encrypted at rest (AES-256-GCM,
`packages/shared/src/crypto.ts`), shown once, following `EmailChannel`'s
precedent exactly** — a genuinely recoverable secret (needed to HMAC-sign
every future delivery), not a hash. Signature: `X-Seredina-Signature:
sha256=<hmac-sha256 hex of the raw JSON body>`, the same convention
GitHub/Stripe use, so an existing receiver implementation on the tenant's side
likely already knows how to verify it.

**https:// is required, checked at creation time.** Rejected outright, not a
warning — matches the "force HTTPS" posture already established elsewhere in
this project (ADR-less but see the security-hardening pass in
`docs/ROADMAP.md`).

**A best-effort SSRF guard (`packages/shared/src/ssrf.ts`), checked again at
delivery time, not just creation time.** A tenant's webhook URL is untrusted
input pointed at an address of their choosing — the realistic threat is a
tenant (malicious or a compromised account) pointing a webhook at
`169.254.169.254` (the AWS/GCP/Azure cloud metadata IP, the single most common
real-world SSRF target in multi-tenant SaaS) or at the platform's own internal
network. Checking only at creation time isn't enough since DNS can be
repointed after a webhook is saved — so the resolved IP is checked again
immediately before every delivery attempt in `apps/worker/src/webhooks/
deliver.ts`. **Honest scope, stated plainly rather than implied as complete:**
this is not DNS-rebinding-proof (a TOCTOU window exists between the `dns.lookup`
check and the actual `fetch` connecting), and the private-range list covers the
realistic cases (loopback, RFC1918, link-local/cloud-metadata) but isn't an
exhaustive reserved-range table. Good enough as a first real barrier against
the common case, not a formal security guarantee — worth strengthening (e.g. a
hardened HTTP client that validates the IP on the actual socket connection) if
this product's threat model ever calls for it.

**Delivery is fire-and-forget from the service layer, real BullMQ retry from
the worker.** `dispatchWebhookEvent` (`apps/api/src/lib/webhookDispatch.ts`)
does a short read-only tx to find matching active webhooks, then enqueues
outside that tx — same "never do slow I/O inside `withTenantTx`" rule as email
send. 5 attempts, exponential backoff, on the *job*, not the Worker — caught a
real mistake while wiring this up: BullMQ's retry/backoff options belong on
`queue.add()`'s job options, not the `Worker` constructor, which silently
accepts and ignores them if placed there. Fixed before it shipped.

**Events are deliberately narrow for v1**: `ticket.created`, `ticket.updated`,
`message.created` — wired into `apps/api/src/modules/tickets/service.ts`'s
existing mutation functions (`createTicketFromApi`, `ingestAlert`,
`updateTicket`, `addMessage`), not a generic event-bus. **Internal notes are
unconditionally excluded from `message.created`**, same reasoning as the AI
copilot's prompt-building: a private note must never reach a webhook receiver
a tenant hasn't necessarily trusted with agent-only commentary.

**A known, accepted gap: email-channel-created tickets don't fire
`ticket.created`.** Inbound email ingestion (`apps/worker/src/email/
ingest.ts`) writes directly to the database from the worker process, bypassing
`apps/api`'s service layer entirely — it was never going to be practical to
duplicate the dispatch call there for this pass. Every *reply* to any ticket
regardless of channel does fire `message.created` correctly, since replies
always go through `addMessage` in the API layer. Narrower than "every ticket
creation," stated honestly rather than glossed over.

## Verified

Real infrastructure, not mocked, on both sides of the risk: **4 automated
tests** (https-only rejection, secret-shown-once behavior, `dispatchWebhookEvent`
correctly short-circuiting with zero Redis I/O when no webhook matches the
event, and — where Redis is available — the enqueue path itself), plus **2
pure-function test suites** for the SSRF range logic (`packages/shared`, 4
tests covering IPv4 boundaries including the 169.254.169.254 metadata IP
specifically, and basic IPv6 cases). Full API suite 27/27 green.

Beyond the automated tests, directly exercised against real external
infrastructure: called `deliverWebhook` against a webhook pointed at
`https://127.0.0.1:9999` and confirmed it throws the private-address error
(the guard actually fires); called it again against a real public HTTPS
endpoint (`https://httpbin.org/post`) and confirmed it completes and records
`lastDeliveryStatus: 'success'` in the database. Then, separately, end to end
through the real running system: created a webhook through the browser UI,
created a real ticket via `POST /v1/tickets` against the running API, and
confirmed via the API that the webhook's `lastDeliveryAt`/`lastDeliveryStatus`
updated to match — proving the full pipeline (service dispatch → BullMQ
enqueue → worker pickup → real HTTPS delivery → database update) works
through the actual worker process, not a direct function call.

## Consequences / known v1 limitations

- Email-channel-created tickets don't fire `ticket.created` (see above).
- SSRF guard is best-effort, not DNS-rebinding-proof (see above).
- No delivery history/log beyond the webhook's own single
  `lastDeliveryAt`/`lastDeliveryStatus` pair — no way to see past deliveries
  or replay one that failed.
- No manual "send a test event" button in the UI — an admin has to wait for a
  real ticket event to see whether their receiver is set up correctly.
- No per-tenant rate limiting on outbound deliveries — a tenant generating a
  huge burst of ticket activity could in principle hammer their own receiver;
  not a concern yet at this scale, worth revisiting alongside Phase 4's
  broader multi-tenant load work.
