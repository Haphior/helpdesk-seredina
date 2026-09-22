# ADR 0051: Knowledge base public portal access control

## Status

Accepted, implemented.

## Context

ADR 0018 deliberately made the public KB portal (`/public/:tenantSlug/kb-articles*`)
unauthenticated: Contacts (ticket submitters) have no Seredina account, so the
portal can't gate on login the way the console does. That was the right call
for *who* can read a published article, but it left no control at all over
*whether the portal exists publicly in the first place* — a `published: true`
article was reachable by anyone on the internet who had (or guessed) the
`tenantSlug`/slug, permanently, with no way to turn it off.

User feedback (live-testing a fresh self-hosted instance): "no es poco seguro
que uno llegue y entre a ver el knowledge base si por ejemplo esta en la
nube" — worried about exactly this: a KB meant for internal/team use, or one
a tenant isn't ready to expose, being wide open by default with zero
protection.

The originally-floated fix (a three-tier per-article `visibility`: public /
authenticated / unlisted) doesn't actually fit this product: Contacts have no
account, so an "authenticated" tier would only ever resolve to "agents,"
which is already true of every article via the console regardless of
`published`. A per-article tier doesn't address the real gap either way — the
missing control is at the *portal* level, not the *article* level.

## Approach

Two new, independent controls on a new `TenantKbSettings` model (one row per
tenant, "no row = default" shape matching `TenantAiSettings`/`TenantUiSettings`):

1. **`portalEnabled`** (default `true`) — a hard on/off switch for the entire
   public portal. A tenant that wants a purely internal KB (agents only, via
   the console) turns this off; the public routes then 404 identically to a
   nonexistent tenant, preserving ADR 0018's "never let an unauthenticated
   caller distinguish reasons" property.
2. **`hashedAccessCode`** (default unset) — an optional single shared
   passphrase for the whole portal, bcrypt-hashed (not sha256 like
   `ApiKey.hashedKey` — this is a short, human-chosen, human-typed secret
   shared with real people, not a high-entropy generated token, so it needs a
   slow hash). Not a login: no account, no per-visitor identity, just a
   shared code the tenant hands out to whoever should be able to browse (a
   customer base, an internal team on a cloud instance, etc.). Checked via an
   `X-Kb-Access-Code` header on every public KB request; a missing or wrong
   code 401s with a distinguishable reason (`code_required` / `code_invalid`)
   — unlike the disabled case, a tenant's own choice to gate its portal isn't
   something worth hiding the way tenant existence is elsewhere.

**Default is `portalEnabled: true`, not `false`** — an opt-out, not an
opt-in. Flipping the default would silently break the portal for every
existing tenant that already has published articles live and linked from
elsewhere. The new "Portal settings" panel in the console's Knowledge Base
page (gated on `tickets:manage_all`, same tier as AI Settings) makes the
switch easy to find and turn off, so the fix is "give admins the control,"
not "change the default under them."

**Frontend**: the access code, once entered, is stored in `sessionStorage`
per tenant slug (`apps/web/src/lib/kbAccessCode.ts`) — same per-viewer,
never-synced, try/catch-wrapped posture as every other browser-storage use in
this app — and attached as a header on every subsequent public KB request. A
new shared `KbAccessGate` component (used by both `PublicKb.tsx` and
`PublicKbArticle.tsx`) renders the unlock form and verifies the code against
the article-list route as a lightweight probe before handing it back to the
caller to store.

## Consequences

- A self-hosted tenant that wants a purely internal KB can disable the portal
  entirely in two clicks.
- A cloud tenant that wants some protection without building real customer
  accounts can set one shared code — meaningfully better than "open to
  anyone with the link," though it is explicitly **not** per-visitor
  authentication, auditing, or revocation-per-person; rotating the code is
  the only revocation mechanism, same as any shared-secret scheme.
- Existing tenants see no behavior change until they opt into either control.
- Per-article visibility tiers remain out of scope, for the reason above —
  not a deferred cut, a non-goal given this product's auth model.
