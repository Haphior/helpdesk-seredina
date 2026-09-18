# ADR 0040: Embeddable web widget — a new anonymous, cross-origin ticket channel

## Status

Accepted, implemented.

## Context

Phase 4's remaining "more channels" item: a chat widget a tenant can embed
on their own website (`<script src="...">`), so an anonymous visitor can
start and continue a conversation that lands in Seredina as a normal
ticket. Unlike every other channel built so far (email, API, agent, alert),
this one is:

- **Fully anonymous** — no `ApiKey`, no login, no existing `Contact` record
  to authenticate against. Something has to prove "this browser is the same
  visitor continuing the same conversation" without any of that.
- **Genuinely cross-origin** — the widget script and its API calls run on
  *the tenant's own website*, a domain unknown to Seredina in advance. This
  is a different trust/network shape than every other route in this API,
  which either requires a credential or is only ever called from this
  app's own admin frontend (locked to the operator's configured
  `CORS_ORIGIN`).

## Decisions

**Reuses the existing channel-adapter pattern — `createTicketFromApi` /
`addMessage`, `channel: 'widget'`.** No parallel ticket-creation logic;
`apps/api/src/modules/widget/service.ts` is a thin wrapper, the same shape
as the Grafana integration (ADR 0039) wrapping `ingestAlert`.

**A `widgetToken`, not a session or a login, proves conversation
continuity.** A random 32-byte token (`Ticket.widgetToken`, unique-indexed)
is generated when a conversation starts and handed back to the browser,
which persists it in `localStorage` keyed by tenant slug. Every follow-up
call presents it back; `findTicketByWidgetToken` scopes the lookup to the
caller's own resolved tenant (via the existing `withTenantTx`/RLS
machinery), so a token minted under tenant A can never resolve under
tenant B even if guessed or replayed cross-tenant. Unlike `externalId`
(a dedup key where "not unique yet" is normal), this **is** unique-
constrained: it's a real credential, and a collision would mean one
visitor could read another's conversation.

**A previously-unexercised code path in `addMessage` had a real latent
bug, caught and fixed as part of this feature**: the SLA "first response"
timestamp (`firstRespondedAt`) was stamped for any non-private message
regardless of `authorType`. This was never exercised before because a
`CONTACT`-authored message previously only ever existed as the ticket's
*opening* message (written directly in `createTicketFromApi`/`ingestAlert`,
never through `addMessage`) — the widget is the first feature where a
`CONTACT` sends a genuine *follow-up* through `addMessage`. Fixed by adding
`authorType !== 'CONTACT'` to the guard in
`apps/api/src/modules/tickets/service.ts`; verified by a test that an agent
reply on the same ticket still stamps it correctly (the guard is
author-specific, not disabled).

**CORS for the widget's own routes is handled without touching the global
CORS lockdown**, which needs to stay strict (operators lock `CORS_ORIGIN`
to their own admin domain). `@fastify/cors` is registered with
`fastify-plugin`, which deliberately breaks Fastify's plugin encapsulation
— confirmed by reading `node_modules/@fastify/cors/index.js` — so a second,
more permissive `cors` registration scoped to a child plugin does **not**
stay scoped; it patches the root instance globally. Instead:

- Every widget route sets `config: { cors: false }`, the documented escape
  hatch (`addCorsHeadersHandler`'s `req.routeOptions.config?.cors === false`
  check) that makes the global plugin skip that route entirely.
- `@fastify/cors` also registers its own global wildcard
  `fastify.options('*', ...)` to answer preflight requests. A more specific
  route on the exact same path takes precedence over that wildcard in
  Fastify's router, so `widgetRoutes` registers its own explicit `OPTIONS`
  handler (also `cors: false`) for each of its three paths — otherwise the
  global wildcard would still answer the widget's preflight with headers
  built from the strict `CORS_ORIGIN` list, and the browser would block the
  real request that follows.
- A plain `onSend` hook, added via `app.addHook` inside the `widgetRoutes`
  plugin function (not `fp`-wrapped, so Fastify's encapsulation genuinely
  applies), sets permissive `Access-Control-Allow-*` headers on every
  response from routes registered in that same scope. This is what actually
  answers the preflight and tags the real response, without touching any
  other route in the app.

**A second, independent browser-only blocker was found and fixed the same
way, only reachable by testing in a real browser**: `@fastify/helmet` sets
`Cross-Origin-Resource-Policy: same-origin` globally, which blocks
cross-origin loading of *any* resource from this API — including the
widget script itself — entirely independently of CORS/`Access-Control-*`.
`curl`-based verification cannot catch this (CORP is a browser-enforced
concept with no curl equivalent); a real Playwright browser load of the
widget script from a genuinely different origin failed with
`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` until the same `onSend` hook
above also overrides `Cross-Origin-Resource-Policy` to `cross-origin` for
widget routes (helmet sets it in an `onRequest` hook, which runs before the
widget's own child-scoped `onSend` hook, so the override wins).

**The embeddable script itself (`apps/api/src/modules/widget/widget-
script.ts`) is hand-written vanilla JS, served as a real `.js` HTTP
response, not a built frontend asset** — it has to run standalone on an
arbitrary third-party page with no bundler and no access to this app's
React/Vite tooling. Style isolation uses Shadow DOM
(`element.attachShadow`), not an iframe: simpler (no second HTML-serving
route, no `postMessage` plumbing) and sufficient for keeping the *host*
page's CSS out, which is the only isolation direction this widget actually
needs. `document.currentScript.dataset.tenant` supplies the tenant slug and
the script's own `src` supplies the API origin, so the embed snippet needs
no separate configuration: `<script src="https://<instance>/widget.js"
data-tenant="acme"></script>`.

**No agent-facing UI change was needed.** `TicketDetail.tsx` already
renders `<Badge>{ticket.channel}</Badge>` generically for every channel
value — `widget` tickets show correctly with zero code changes, the same
"reuse what already generalizes" pattern the custom-roles feature hit
earlier this phase (a new role appearing in the Users dropdown for free).

## Consequences

- **`Access-Control-Allow-Origin: *` on the widget's public routes is a
  deliberate, permanent choice, not a placeholder** — a tenant embeds this
  on an unknown third-party domain, so there is no fixed origin to allow
  instead. This is safe specifically because these routes carry no
  credential and set no cookies (`widgetToken` travels as a request body/
  query value, not a cookie), so there's nothing for a hostile page to
  reflect back to itself that it couldn't already get by calling the API
  directly.
- **A leaked `widgetToken` is a real, if narrow, exposure**: whoever holds
  it can read and post to that one conversation (never any other ticket,
  never any other tenant's data). This mirrors an anonymous support-chat
  session token in effect, not a design gap specific to Seredina.
- **The widget script is served from source on every request, not a hashed/
  cached build artifact** — deliberately short `Cache-Control` (5 minutes),
  not immutable, so a deployed fix reaches already-embedded pages soon
  after redeploying, at the cost of one extra request per page load that a
  fingerprinted asset could have avoided.
- **Polling, not push** — the widget re-fetches the conversation every 5
  seconds while open, consistent with ADR 0019's existing short-poll
  precedent elsewhere in this app rather than introducing a new realtime
  mechanism just for this one surface.

## Verified

**`apps/api/test/widget.test.ts`, 7 tests, live Postgres**: starting a
conversation creates a real ticket with a `CONTACT` opening message and a
64-char `widgetToken`; a follow-up via `addWidgetMessage` appends a real
`CONTACT` message on the same ticket; a `CONTACT` follow-up never stamps
`firstRespondedAt` (the bug fix); a real agent reply on the same ticket
still stamps it (proving the guard is author-specific, not disabled
outright); `getWidgetConversation` returns messages in order and excludes
private notes; an unknown `widgetToken` is rejected the same way for both
read and write; a `widgetToken` minted under one tenant is invisible under
another (RLS scoping applies to this lookup like any other). Full `apps/api`
suite re-run after adding this: 220/220 passing (9 skipped, unrelated).
Every workspace (`packages/db`, `shared`, `ai-adapters`, `apps/api`, `web`,
`worker`, `mcp-server`) typechecks clean.

**Real, live, end-to-end against the running dev stack — not mocked, and
including a genuine cross-origin browser test, not just `curl`**:
registered a real tenant, `curl`-verified the CORS/CORP fix directly (a
real `OPTIONS` preflight from `Origin: https://third-party-site.example`
against the widget's routes returns `204` with
`access-control-allow-origin: *`; the actual `POST`/error responses carry
the same headers). Full happy path via `curl`: started a conversation,
posted a follow-up, fetched the conversation back with both messages in
order; confirmed `firstRespondedAt` stayed `null` after CONTACT-only
messages on the live ticket; confirmed a wrong `widgetToken` and a wrong
tenant slug both `404` identically, and that a second tenant's slug
combined with the first tenant's real `widgetToken` also `404`s rather than
leaking the conversation.

**Then, specifically because this feature is browser-cross-origin in a way
nothing else in this app is, verified in a real Playwright-driven Chromium
browser, not just `curl`**: served the widget's own test host page from a
genuinely different origin/port than the API. First attempt failed with
`net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` loading the script itself —
this is the helmet CORP finding above, caught only because this was a real
browser load, not a header inspection. After the fix: the bubble renders,
clicking it opens the panel, filling the pre-chat form and submitting
starts a real conversation and renders the opening message, sending a
follow-up message appends it, reloading the page resumes the same
conversation from `localStorage` without re-showing the pre-chat form, and
a reply posted through the real admin ticket API
(`POST /tickets/:id/messages`, simulating an agent) appears in the widget
within one poll cycle with no widget-side action. Zero browser console
errors throughout.
