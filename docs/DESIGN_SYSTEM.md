# Seredina Design System

This is the "set up a design system" checklist item, written up after the fact: the
visual direction was explored first as a Claude Design canvas mockup (four screens:
tickets list, ticket detail, sign in, register), approved, then implemented directly
in `apps/web` with Tailwind. This doc documents what's actually in the code — it is
not a second source of truth. When the two disagree, the code is right and this doc
is stale; update this doc, don't "correct" the code to match it.

## Typography

**Plus Jakarta Sans** (Google Font), loaded via `<link>` in `apps/web/index.html`
and set as `theme.extend.fontFamily.sans` in `apps/web/tailwind.config.js` — so
plain `font-sans` (or the Tailwind default, since it's the `sans` override) gets it
everywhere. Fallback stack: `ui-sans-serif, system-ui, sans-serif`.

Weights in use: 400 (body), 500/600 (labels, nav), 700/800 (headings, brand
wordmark, primary buttons). No other typeface — don't introduce a second font
without a reason.

Sizes are mostly arbitrary values (`text-[13px]`, `text-[22px]`, …) rather than
Tailwind's default type scale, because the mockup was authored in raw px and
carried over as-is rather than rounded to the nearest default step. Match the
nearby arbitrary value when extending a screen rather than switching to the
default scale mid-page (visible inconsistency otherwise).

## Color

Base neutral: **slate** (`slate-50` background, `slate-200`/`slate-100` borders,
`slate-400`/`slate-500`/`slate-600` for secondary text, `slate-900` for primary
text/headings). This was already the app's neutral before the redesign — kept, not
replaced.

**The `slate` scale is theme-variable, not literal** (ADR 0042). `tailwind.config.js`
remaps `theme.extend.colors.slate.{50..950}` to `var(--n-50)` … `var(--n-950)`;
`apps/web/src/index.css` defines two value sets for those variables, switched by a
`data-theme` attribute on `<html>`:

| Theme | `data-theme` | `--n-50` | `--n-950` | Notes |
| --- | --- | --- | --- | --- |
| Meet in the Middle (default) | *(absent)* | `#f7f5f1` | `#181512` | Warm stone. Ships with the channel glyph (below). |
| Refined | `refined` | `#f8fafc` | `#020617` | Tailwind's own real default slate hex — the originally-shipped look, reproduced exactly. |

Because every page already used plain `slate-*` classes (confirmed: the only
neutral family in use anywhere, ~700 occurrences across 49 files), this makes the
whole app theme-aware with no changes to page code — a page should keep writing
`bg-slate-50`/`text-slate-500`/etc. as normal; it inherits whichever theme is
active. Never hardcode a literal slate hex or `rgb()` value in a component — that
bypasses the variable and breaks under "Refined" or any future theme.

Tenants choose their theme in Settings → Appearance (`ThemeSettings.tsx`,
`GET`/`PATCH /ui-settings`); stored per-tenant, default when unset. See ADR 0042 for
the full mechanism, the `ChannelGlyph` channel-to-circle mapping, and a React
state-sync bug worth knowing about if you touch `ThemeContext.tsx`.

Brand accent: **indigo → violet**, used for the logo mark's three overlapping
circles (indigo-400/indigo-500/violet-500, see `docs/BRAND.md`), primary buttons
(`bg-indigo-600`, hover `indigo-700`), active nav state (`bg-indigo-50
text-indigo-700`), and the login/register brand panel
(`from-indigo-700 via-indigo-500 to-violet-500`). Don't introduce a third accent hue
— extend indigo/violet shades instead.

**Status and priority tones are the semantic core of the palette** and are defined
in exactly two places — treat these as the single source of truth, don't
reintroduce string literals like `'blue'`/`'red'` elsewhere:

| Meaning | Tone name | Tailwind family | Defined in |
|---|---|---|---|
| Status: Open | `sky` | sky-50/500/700 | `lib/format.ts` → `STATUS_CATEGORY_TONE.OPEN` |
| Status: Pending | `amber` | amber-50/500/700 | `STATUS_CATEGORY_TONE.PENDING` |
| Status: Resolved | `emerald` | emerald-50/500/700 | `STATUS_CATEGORY_TONE.RESOLVED` |
| Status: Closed | `slate` | slate-100/400/600 | `STATUS_CATEGORY_TONE.CLOSED` |
| Priority: Low | `slate` | slate-100/400/600 | `lib/format.ts` → `PRIORITY_TONE.LOW` |
| Priority: Normal | `indigo` | indigo-50/400/700 | `PRIORITY_TONE.NORMAL` |
| Priority: High | `orange` | orange-50/500/700 | `PRIORITY_TONE.HIGH` |
| Priority: Urgent | `rose` | rose-50/500/700 | `PRIORITY_TONE.URGENT` |

The actual bg/text/dot Tailwind classes per tone name live in
`components/Badge.tsx`'s `TONES` map — adding a new tone means adding one entry
there, never inlining a one-off color on a status/priority badge.

Internal notes (private messages on a ticket) get their own fixed treatment —
amber border/background (`border-amber-200 bg-amber-50`), independent of the
status/priority tone system — because "this is private" is a different axis of
meaning than ticket status, and reusing the Pending-status amber here is
coincidental, not a coupling to rely on.

Errors: `rose-600` in every screen touched by the redesign (Tickets, Ticket
detail, Login, Register). Older untouched pages (Assets, Users, ApiKeys,
EmailChannels) still use `red-600` for errors — harmless, but if you're touching
one of those pages anyway, align it to `rose-600`.

## Spacing, radius, elevation

- Cards/panels: `rounded-xl` (bigger surfaces — message bubbles, the ticket table
  wrapper) or `rounded-lg`/`rounded-[9px]` (controls — buttons, inputs, selects).
  `rounded-full` for badges, avatars, and pill-shaped toggles.
- Borders: `border-slate-200` (or `-100` for a lighter hairline between rows).
- Elevation is a single `shadow-sm` on top-level cards/buttons — never stack
  multiple shadow levels or introduce a heavier shadow; the whole app is meant to
  read as flat-with-hairlines, not skeuomorphic.
- Layout: flex/grid with `gap-*`, not manual margins between siblings (a nav list,
  a badge row, a details panel's rows) — keeps spacing consistent and easy to
  adjust in one place.

## Components

- **`components/Button.tsx`**, **`components/Input.tsx`**, **`components/Select.tsx`**,
  **`components/Card.tsx`** — the shared primitives an app-wide UI pass (see the
  "not yet reviewed" note below, now closed) extracted after finding the same
  button/input/select/card Tailwind strings hand-duplicated with visible drift
  across 10+ pages. Compose these for any new control or surface instead of
  reaching for another inline Tailwind string. `Button`/`Input`/`Select` each
  require either a visible label or an explicit `aria-label` at the type level
  (a discriminated union, not just a lint rule) — an unlabeled icon-only button
  or hidden-label input fails to compile.
- **`components/Badge.tsx`** — pill badge, optional leading `dot` prop for
  status/priority (see color table above). Never render a badge with an inline
  one-off color; add a tone to `TONES` instead.
- **`components/Avatar.tsx`** — initials-in-circle, deterministic color from a hash
  of the name (5-color palette). Used for any person (agent or contact) anywhere
  in the UI — don't hand-roll another avatar pattern.
- **`components/icons.tsx`** — the complete icon set, inline stroke SVG (20px
  viewBox, `stroke-width` 1.6-2, round caps/joins), no icon library dependency.
  **Never use emoji or a dingbat character as a UI icon** — draw a new one in this
  file, matching the existing stroke style, if the icon set is missing something.
- **`components/AuthLayout.tsx`** — the split brand-panel/form shell shared by
  Login and Register, plus the shared `Field` component for labeled text inputs.
- **Sidebar** (`components/Layout.tsx`) — logo mark, tenant name (from
  `GET /auth/me`), icon+label nav items, user identity footer with avatar/role/
  logout. This is the one piece of chrome every authenticated page shares — a new
  page under `RequireAuth` gets it for free via the `Layout` route wrapper.
- **Property row / property select** (in `pages/TicketDetail.tsx`) — the
  label-left/control-right pattern for the ticket details panel
  (`PropertyRow`/`PropertySelect`). Reuse this shape for any future "detail view
  with a right-side inspector" screen (e.g. an Asset detail page) rather than
  reintroducing the old label-above-input `FieldGroup` shape.
- **`components/Modal.tsx`** — traps focus while open (Tab/Shift+Tab cycle
  within the dialog, Escape closes it) and restores focus to whatever
  triggered it on close. This was a real gap until the app-wide UI pass below;
  a modal opened from a page with no focus management left keyboard focus
  stranded once it closed.

## App-wide UI pass (Impeccable + Vercel/Rauno interface guidelines)

The "not yet reviewed" gap noted below was closed by a systematic pass across
every page: extracted the missing `Button`/`Input`/`Select`/`Card` primitives,
fixed `Modal`'s missing focus trap, added `aria-label`s to icon-only controls
that had none, and replaced every bare `focus:outline-none` (several existed
with no replacement focus indicator — a real regression vs. the browser
default) with the shared focus-ring treatment. See `docs/DESIGN.md` for the
machine-readable token extraction this pass produced for Impeccable's own
design-detector hook.

### Previously "not yet reviewed" (now covered)

`pages/Assets.tsx`, `pages/Users.tsx`, `pages/ApiKeys.tsx`,
`pages/EmailChannels.tsx`, and `components/AssetFormModal.tsx` were left alone in
the original 4-screen redesign pass — they used the pre-redesign plain-Tailwind
look apart from the shared `Badge`/`Layout` components they already consumed.
Brought in line with the rest of the app in the pass above.
