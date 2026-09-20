# ADR 0043: Tenant branding / white-label (v1: logo + accent color on the customer-facing portal)

## Status

Accepted, implemented.

## Context

`docs/ROADMAP.md`'s "Deep customization" section named this as still missing to make
the tenant-customization story complete: "every tenant currently sees Seredina's own
brand regardless of who they are." ADR 0042 (the tenant UI theme system) explicitly
scoped this out as a separable follow-up — that ADR's theme mechanism covers the
*internal admin console*'s neutral warmth (Middle vs. Refined), gated by its own "One
Accent Rule": the indigo/violet accent there is Seredina's own fixed brand identity,
never themed away. Tenant branding is a different surface entirely — a tenant's own
logo and color on the pages *their own customers* see: the self-service KB portal
(`PublicKb`/`PublicKbArticle`) and the public status page (`PublicStatus`).

## Decisions

**Storage**: a single `Tenant.branding Json?` column — `{ logoUrl?: string, accentColor?: string }`,
`null`/absent meaning no white-label set. No new table: unlike `TenantAiSettings`/
`TenantUiSettings`, this data has no independent identity or lifecycle worth a row of
its own, and `Tenant` already has an RLS policy + `TENANT_SCOPE_FIELD: 'id'` entry
covering it. Roadmap named this shape explicitly ("a `Tenant.branding` jsonb blob...
is enough for v1; no theming engine needed for that scope") rather than it being
invented here.

**Scope, deliberately not larger**: `logoUrl` is a plain URL the tenant hosts
themselves (their own website, a CDN they already use) — not a file upload. Building
upload-and-host-here infrastructure would be a real, separate feature (this app has
no general-purpose public asset storage; `Attachment` stores message attachment bytes
behind an authenticated route, a different trust boundary entirely) and the roadmap's
own "logo URL" language already implies this scope. `accentColor` is a single hex
color used for one thing: the portal header's wordmark text — the 3 public pages had
*zero* existing accent-colored elements to reuse or reskin, so this is a real, new,
narrow touchpoint rather than manufacturing extra "themeable" surface just to give
the color somewhere to go.

**`GET /tenant-branding`** (any authenticated user — matches `GET /ui-settings`'s
reasoning, though in practice only the settings page consumes it) and **`PATCH
/tenant-branding`** (`tickets:manage_all`, same tier as Appearance/AI Settings) live
in a new `modules/branding/`. `PATCH` merges into the existing blob rather than
replacing it wholesale: an explicit `null` for one field clears just that field, an
omitted field is untouched — lets a tenant clear their logo without also having to
retype their accent color.

**`GET /public/:tenantSlug/branding`** is unauthenticated, resolving the tenant by
slug exactly like `modules/kb`'s existing `/public/:tenantSlug/kb-articles` routes
(`resolveTenantIdBySlug` → a Postgres `SECURITY DEFINER` function, the one
established, narrow exception to "always requires a bound tenant context" — see
`modules/tenants/service.ts`). 404 for an unknown slug, matching the KB routes'
same "don't let response shape distinguish wrong-slug from anything else" posture.

**Frontend**: a new shared `components/PortalBrand.tsx` replaces the identical
logo+wordmark header markup that had been duplicated verbatim across all 3 public
pages — fetches branding by the URL's own `tenantSlug` param, renders the tenant's
`<img>` logo (falling back to Seredina's own `<Logo>` on a load error, e.g. a dead
URL) and colors the wordmark with `accentColor` when set. A new `BrandingSettings.tsx`
page (`/branding`, Administration nav group, next to Appearance) has a live preview
of exactly this header, using the same rendering logic, so what an admin sees while
typing is what their customers will actually see — not a separate mockup that could
drift from the real component.

**What deliberately stays untouched**: `Login`/`Register` and the internal admin
console. `Login`/`Register` don't know which tenant they're branding *for* until the
slug field is filled in — unlike the 3 public pages, which already carry `tenantSlug`
in the URL path (`/kb/:tenantSlug`, `/status/:tenantSlug`), there's no URL-based
signal to key a live-branding fetch off before the user starts typing, and debounced
fetch-as-you-type has real UX problems (flicker on typos, wrong branding briefly
shown for a similar-but-different slug). A real fix looks like a
`/login/:tenantSlug`-style URL scheme, which is a routing change, not a branding
one — named here as a real gap rather than silently worked around. The internal
admin console is excluded on purpose, not by oversight: ADR 0042's One Accent Rule
means an agent's own working tool always looks like Seredina, regardless of which
tenant they're logged into — only the surfaces a tenant's *own customers* see should
ever show someone else's brand.

## Consequences

- `PortalBrand` also removed ~9 lines of duplicated header JSX from each of the 3
  public pages — a real, incidental DRY win from centralizing branding lookup, not
  the point of the change but worth noting.
- A tenant that sets a `logoUrl` pointing at a URL that later goes dead (deleted
  image, expired hotlink) degrades gracefully to Seredina's own logo via `onError`,
  never a broken-image icon.
- If a future pass adds tenant-side asset upload (e.g., for email template logos —
  already named as a separate, not-yet-built item in the same "Deep customization"
  roadmap section), `branding.logoUrl` should point at whatever URL that upload
  produces; no schema change needed here to support it later.

## Verified

9 new integration tests (`apps/api/test/tenant-branding.test.ts`, live Postgres):
default-null with no branding set, setting both fields persists and round-trips,
setting one field leaves the other untouched (merge semantics), an explicit `null`
clears just that field, a non-URL `logoUrl` and a non-hex `accentColor` are both
rejected, branding set for one tenant is invisible to another (RLS scoping, like any
other tenant-owned field), and the public-by-slug lookup returns identical data to
the authenticated lookup for a known slug and `null` for an unknown one. Full
`apps/api` suite 234/234 green (was 225 before this pass); `apps/web` typechecks
clean and the production build succeeds.

Live, in a running Chromium browser against the real dev stack: registered a fresh
tenant, confirmed the public Help Center page shows Seredina's own default logo and
slate-900 wordmark with no branding set. Set a logo URL and an accent color through
the real Branding settings page — the live preview updated immediately and matched
what the actually-published public KB and status pages rendered afterward (custom
logo image loaded, wordmark recolored to the chosen hex on both pages). Confirmed
the internal admin console's own sidebar wordmark stayed Seredina's default color
throughout — the One Accent Rule holds. Zero console errors across the whole flow.
