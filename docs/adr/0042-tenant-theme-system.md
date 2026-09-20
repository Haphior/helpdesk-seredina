# ADR 0042: Tenant-configurable UI theme system ("Meet in the Middle" default)

## Status

Accepted, implemented.

## Context

After the app-wide UI quality pass (ADR 0041), the user explored 3 visual directions as design-canvas mockups and picked "Meet in the Middle": a warm-neutral refinement of the existing brand — same indigo/violet accent and Plus Jakarta Sans, warmed through a stone neutral instead of cool slate, plus a new on-brand functional detail, a 3-circle "via channel" glyph reusing the logo's own colors/meaning (`docs/BRAND.md`: the logo's 3 unequal overlapping circles represent `Ticket.channel` converging into one ticket). The request was for a real, tenant-configurable theme system with this as the default, keeping the original look ("Refined") available as an alternate, not deleted.

## Key mechanism

The app's neutral palette uses Tailwind's `slate-*` utility classes directly, and **only** `slate` — confirmed via grep across the whole `apps/web/src` tree: zero `gray-*`/`stone-*`/`zinc-*`/`neutral-*` usage anywhere, ~700 occurrences of `slate-*` across 49 files and all 10 shades (50–950). Rewriting all of them by hand to support a second palette would have been the obvious-but-wrong approach.

Instead: Tailwind 3.4.14 allows `theme.extend.colors` values to be literal `var(--x)` strings. Remapping the `slate` key in `tailwind.config.js` to `var(--n-50)` … `var(--n-950)` means every existing `bg-slate-100`/`text-slate-500`/`border-slate-200` class across all 49 files becomes runtime-theme-aware with **zero changes to those files**. The two themes are then just two blocks of CSS custom-property values in `index.css`, switched by a `data-theme` attribute on `<html>`:

- Bare `:root` (no attribute) = the default, "Meet in the Middle" — a warm-stone 10-step scale (`#f7f5f1` → `#181512`).
- `[data-theme="refined"]` = Tailwind's own real default slate hex values (`#f8fafc` … `#020617`, pulled directly from the `tailwindcss/colors` npm package, not approximated) — this reproduces the originally-shipped look exactly, not an approximation of it.

The indigo/violet accent is deliberately **not** theme-variable — it's the actual brand identity, not a mood setting. Both themes share the same accent; only neutral warmth changes.

## Decisions

**Storage — `TenantUiSettings`**, mirroring the existing "one row per tenant, no row = default" shape used by `TenantAiSettings`: `id`, `tenantId @unique`, `theme: String?` (`null` = default = `'middle'`), `createdAt`, `updatedAt`. Moves as the usual 3 files for a new tenant-scoped table: `schema.prisma`, `TENANT_SCOPE_FIELD` in `packages/db/src/prisma.ts`, and the GRANT list + `FOREACH` array in `packages/db/prisma/rls/policies.sql`.

**API — `apps/api/src/modules/uisettings/`**: `GET /ui-settings` (any authenticated user — everyone needs to render the correct theme, not just admins), `GET /ui-settings/themes` (the theme catalog with name/description, so the settings page doesn't hardcode copy twice), `PATCH /ui-settings` (`tickets:manage_all`, matching the AI Settings / Business Hours precedent for tenant-wide config).

**Channel → glyph mapping.** `Ticket.channel` has grown to 6 real values (`email`/`api`/`alert`/`widget`/`catalog`/`agent`) while the logo's meaning was fixed at 3 circles when the brand only had 3 channels. The glyph maps them down: `email` → circle 1, `{api, catalog, widget}` → circle 2 (all API-mechanism channels), `alert` → circle 3, `agent` → all three circles dim/uniform (a human typed it in; nothing external converged). This is a deliberate interpretive simplification for the glyph, not a fact pulled from anywhere else in the codebase.

**Frontend — `ThemeContext`/`ThemeProvider`** owns both the fetch and the state, mounted inside `Layout.tsx` (theme only matters post-login; `Login`/`Register` and the 3 public pages stay on the fixed default — a deliberate scope cut, below). `ChannelGlyph.tsx` renders in `TicketsQueue.tsx` and `TicketDetail.tsx`, gated on `theme !== 'refined'`. `ThemeSettings.tsx` (new `/appearance` page, under Administration in the nav) lets an admin switch instantly — `applyTheme` sets the DOM attribute and context value immediately, then persists via `PATCH`, reverting on failure.

**Out of scope, named rather than silently skipped**: the 3 public pages and `Login`/`Register` keep the fixed default regardless of tenant choice (reflecting tenant branding pre-login would need a new unauthenticated-by-slug theme lookup — a real but separable follow-up). No true dark mode. No per-user preference, only per-tenant.

## A real bug found during verification

`ThemeProvider` originally took its initial theme as a prop (`initialTheme`) from `Layout.tsx`, which did its own `/ui-settings` fetch and passed the resolved value down. This doesn't work: React's `useState(initialTheme)` only consults its argument on the component's *first* render — a prop update on a later re-render is silently ignored. `Layout`'s fetch resolved after the first render and re-rendered with the correct prop value, but `ThemeProvider`'s internal `theme` state stayed stuck at `'middle'` forever. `applyThemeToDocument` was also being called directly in `Layout`'s effect, unconditional on React state, so the DOM attribute and CSS variables updated correctly — the bug was invisible to a plain screenshot, but the React Context value driving `ChannelGlyph`'s conditional rendering never updated, so glyphs kept rendering under the "Refined" theme, which is supposed to show none.

Caught by a targeted script asserting on `document.documentElement.dataset.theme` *and* the actual rendered glyph count together, not either alone — a scenario where the DOM and React disagree specifically won't show up if you only check one of them. Fixed by moving the `/ui-settings` fetch inside `ThemeProvider` itself, removing the prop entirely: a single source of truth instead of a value derived from a prop that can't be re-derived.

## Consequences

- Any future second theme is nearly free to add: another CSS-variable block plus one `UI_THEMES` entry — the token mechanism doesn't need touching again.
- The `useState(prop)` anti-pattern is worth watching for elsewhere in this codebase: it's silent (no error, no lint warning) and only manifests as "the value updates in the DOM/network but not in a React-driven conditional," which looks like an unrelated bug in whatever reads the stale state.

## Verified

`apps/api/test/ui-settings.test.ts` (5/5 passing): fresh tenant defaults to `'middle'` with no settings row, `PATCH` persists and `GET` reflects it, switching back to `'middle'` is a real update (not a row delete), an invalid theme key is rejected, and a theme set for one tenant is invisible to another (RLS scoping, like any other tenant-owned row).

Live, in a running Chromium browser: registered a tenant, confirmed the default renders "Meet in the Middle" with no settings row yet (warm `--n-50: #f7f5f1`, channel glyphs visible on Tickets and Ticket Detail with distinct colors per channel). Switched to "Refined" via the Appearance page and confirmed, in one pass: the CSS variables switch to Tailwind's real slate defaults (`--n-50: #f8fafc`), the channel glyph disappears from both Tickets and Ticket Detail, the Appearance page's own "Active" badge tracks the current theme, the choice persists across a full page reload, and zero console errors throughout. This full cycle was re-run after the `useState`/prop bug fix above and confirmed the fix: glyph count is `3` under "Meet in the Middle" and `0` under "Refined," matching the DOM attribute in both cases (the pre-fix run showed `3` glyphs even while the DOM correctly read `refined`).
