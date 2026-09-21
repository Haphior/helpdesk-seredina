---
name: Seredina
description: Multi-tenant helpdesk/ITSM admin console — modern, restrained SaaS UX
colors:
  brand-indigo: "#4f46e5"
  brand-violet: "#8b5cf6"
  neutral-bg: "#f7f5f1"
  neutral-text: "#26221d"
  neutral-border: "#e4ded2"
  status-open: "#0ea5e9"
  status-pending: "#f59e0b"
  status-resolved: "#10b981"
  status-closed: "#94a3b8"
  priority-low: "#94a3b8"
  priority-normal: "#818cf8"
  priority-high: "#f97316"
  priority-urgent: "#f43f5e"
typography:
  body:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
  headline:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.3
  caption:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.04em"
  subhead:
    fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
rounded:
  control: "9px"
  card: "12px"
  pill: "9999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand-indigo}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Seredina

<!-- Written by extracting apps/web's existing Tailwind config, lib/format.ts's
tone maps, and the hand-written docs/DESIGN_SYSTEM.md (the code's own source
of truth) rather than a creative-language interview -- this file exists so
the Impeccable design-detector hook has real tokens to check drift against
during the app-wide UI pass, not to drive a live design panel. Keep it in
sync with docs/DESIGN_SYSTEM.md; that file has the fuller narrative and stays
the primary reference for a human contributor. -->

## Overview

A dense, professional admin console for IT/helpdesk agents, not a marketing
surface: legibility and scanability outrank expression (Operate mode). The
palette is restrained on purpose — one brand accent (indigo→violet), a slate
neutral scale, and a small semantic set of status/priority tones — so color
stays meaningful (this ticket is Urgent) rather than decorative.

**Key characteristics:**
- Flat surfaces with hairline borders; a single, non-stacked `shadow-sm` is
  the only elevation cue.
- One accent hue family (indigo/violet) for brand and primary actions; every
  other color on screen is either the slate neutral scale or a semantic
  status/priority tone.
- Compact type sizes (mostly 12.5–13.5px), matched to an information-dense,
  desktop-first tool used all day, not a leisurely reading surface.

## Colors

### Primary
- **Brand Indigo** (`#4f46e5`, Tailwind `indigo-600`): primary buttons, active nav state background pairs with `indigo-700`/`indigo-50`.
- **Brand Violet** (`#8b5cf6`, Tailwind `violet-500`): only in the indigo→violet gradient (logo mark, auth screens' brand panel) — never used as a flat fill on its own.

### Neutral
The `slate-*` scale is theme-variable (ADR 0042: `tailwind.config.js` remaps it to
`var(--n-50)`…`var(--n-950)`, defined per-theme in `apps/web/src/index.css`), so
values below are the **default theme's** resolved values, not fixed constants —
never hardcode them as literals in a component.

- **Slate 50** (default theme "Meet in the Middle": `#f7f5f1`; "Refined": `#f8fafc`): app background.
- **Slate 200 / 100** (default: `#e4ded2` / `#efebe4`; "Refined": `#e2e8f0` / `#f1f5f9`): borders — 200 for a standard divider, 100 for a lighter hairline between table rows.
- **Slate 400 / 500 / 600**: secondary text, in increasing emphasis order.
- **Slate 900** (default: `#26221d`; "Refined": `#0f172a`): primary text and headings.

### Status tones (semantic, defined once in `apps/web/src/lib/format.ts`'s `STATUS_CATEGORY_TONE`)
- **Sky** — Open. **Amber** — Pending. **Emerald** — Resolved. **Slate** — Closed.

### Priority tones (`PRIORITY_TONE`, same file)
- **Slate** — Low. **Indigo** — Normal. **Orange** — High. **Rose** — Urgent.

### Named Rules
**The One Accent Rule.** The brand accent is indigo/violet only — extend its shades for new needs, never introduce a third hue as a second "brand" color.

**The Theme Variable Rule** (ADR 0042). Never write a literal slate hex/`rgb()` value in a component — always use the `slate-*` Tailwind classes so the value resolves through the active theme's CSS variables. A literal value renders correctly under the default theme and silently wrong under "Refined" (or any theme added later).

**The Tone-Table Rule.** A status/priority badge's color always comes from `STATUS_CATEGORY_TONE`/`PRIORITY_TONE` → `Badge`'s `TONES` map. A one-off inline color on a status badge is always wrong, not a style choice.

## Typography

**Body Font:** Plus Jakarta Sans, with `ui-sans-serif, system-ui, sans-serif` fallback — the only typeface in the app.

**Character:** A single, well-weighted grotesque carrying both dense data tables and marketing-adjacent surfaces (auth screens) without switching voice.

### Hierarchy
- **Headline** (700, ~22px): page titles.
- **Title** (600, ~14–15px): card/section headings, ticket subject line.
- **Body** (400, ~13.5px): the default text size everywhere — table cells, message bodies, most controls.
- **Label** (600, ~12.5px): form field labels, nav items, small caps-adjacent UI text (not actually uppercased).
- **Caption** (700, 11.5px, `0.04em` tracking): uppercase table/list-section headers (e.g. a table's column-header row).
- **Subhead** (700, 15px): a named section within a page below the page's own `<h1>` (e.g. "Activity log", "On-call schedules").

### Named Rules
**The Nearby-Value Rule.** Sizes are mostly arbitrary px values (`text-[13px]`) carried over from the original mockup, not Tailwind's default scale — when extending a screen, match the nearest existing arbitrary value rather than switching to the default scale mid-page.

## Layout

Flex/grid with `gap-*` between siblings, not manual margins — keeps a page's rhythm adjustable in one place. Sidebar shell is a fixed `248px` width; content area is fluid. No defined responsive breakpoint strategy yet for the admin views (desktop-first; only the public-facing pages — PublicKb, PublicStatus — are meant to work well on a phone-sized viewport).

## Elevation & Depth

Flat by default. A single `shadow-sm` is the only elevation token, applied to top-level cards and buttons — never stacked, never a heavier shadow.

### Named Rules
**The Flat-By-Default Rule.** Depth comes from a hairline border first; `shadow-sm` is a light lift on top of that, not a substitute for it, and never doubled up.

## Shapes

`rounded-xl` (12px) for big surfaces (cards, message bubbles, the ticket table wrapper); `rounded-lg`/`rounded-[9px]` for controls (buttons, inputs, selects); `rounded-full` for badges, avatars, and pill toggles.

## Components

### Buttons (`components/Button.tsx`)
- **Shape:** `rounded-lg` (9px).
- **Primary:** `bg-indigo-600` / hover `indigo-700`, white text, `shadow-sm`.
- **Secondary:** white fill, `border-slate-200`, slate text.
- **Ghost:** no fill/border at rest, `hover:bg-slate-100`.
- **Danger:** `bg-rose-600` / hover `rose-700`.
- **Hover/Focus:** background-color transition only (no font-weight shift, no layout shift); focus-visible ring via `box-shadow` (Tailwind `ring-2 ring-indigo-300`), never a browser `outline`.

### Inputs (`components/Input.tsx`)
- **Style:** white fill, `border-slate-200`, `rounded-[9px]`.
- **Focus:** border shifts to `indigo-400` plus a `ring-2 ring-indigo-100` glow.
- **Disabled:** `bg-slate-50`, `text-slate-400`.

### Select (`components/Select.tsx`)
- Native `<select>`, same visual shell as Input, a trailing chevron icon.

### Cards (`components/Card.tsx`)
- **Corner Style:** `rounded-xl`.
- **Background:** white.
- **Shadow Strategy:** the single `shadow-sm` token; see Elevation & Depth.
- **Border:** `border-slate-200`.
- **Internal Padding:** `p-4`.

### Badges (`components/Badge.tsx`)
- Pill shape, one of 7 tones (see Colors), optional leading dot. Never a one-off inline color.

### Navigation (`components/Layout.tsx`)
- Grouped sidebar (Work / CMDB / Configuration / Operations / Administration), icon + label per item, active state `bg-indigo-50 text-indigo-700`, inactive `text-slate-600 hover:bg-slate-100`.

### Modal (`components/Modal.tsx`)
- Centered dialog over a `black/30` backdrop, `rounded-lg`, `shadow-lg`. Traps focus while open and restores it to the trigger on close.

### Channel Glyph (`components/ChannelGlyph.tsx`)
- The logo's 3-circle motif, made functional: highlights which channel-group a ticket arrived through (email / api·catalog·widget / alert), dimmed uniformly for agent-logged tickets. Renders only under the default theme ("Meet in the Middle") — hidden under "Refined" via `theme !== 'refined'` at each call site (`TicketsQueue.tsx`, `TicketDetail.tsx`).

### Webhooks (`pages/Webhooks.tsx`)
- A "Type" selector (Generic/Slack/Microsoft Teams) in the create modal narrows the Events checklist to a curated 3-event subset for Slack/Teams and swaps in real, platform-specific setup instructions + URL placeholder. The list view shows a `Badge` naming the kind (hidden for the default "Generic") and hides "rotate secret" for a kind with no secret to rotate.

### Devices (`pages/Devices.tsx`)
- CMDB nav group. A "Generate enrollment command" button reveals a one-time, copy-pasteable shell command (`components/Copyable.tsx`'s `CopyableCodeBlock`, extracted from `MonitoringIntegrations.tsx` once a second page needed it) and a device table (hostname/platform/last check-in/status, `Active`/`Revoked` badges). Each row links to the enrolled device's own `Asset` detail page, which gets a read-only "Agent inventory" card (CPU/memory/OS version/disk encryption/antivirus/disk breakdown) when `discoverySource === 'AGENT'`.

### CSAT Survey (`pages/PublicCsat.tsx`)
- Public, unauthenticated page at `/csat/:tenantSlug/:token`. Uses `PortalBrand` like the other 2 public pages. A 5-star `StarPicker` (amber fill on select/hover) plus an optional comment field; submitting shows a read-only filled-star summary and a thank-you, and reloading the same link shows that same state rather than the form again (the answer is idempotent).

### Appearance (`pages/ThemeSettings.tsx`)
- Two selectable cards (one per `UI_THEMES` entry), each with a small static swatch preview and name/description. Selecting one applies instantly (`ThemeContext`'s `applyTheme`) and persists via `PATCH /ui-settings`, reverting the DOM/context on a failed save.

### Portal Brand (`components/PortalBrand.tsx`) and Branding (`pages/BrandingSettings.tsx`)
- Shared header for the 3 public pages (`PublicKb`, `PublicKbArticle`, `PublicStatus`): a tenant's own logo (falling back to the Seredina `Logo` on a missing/broken URL) and an `accentColor`-tinted wordmark. `BrandingSettings.tsx` (`/branding`, Administration) edits both fields and renders the identical header markup as a live preview. Scoped to the customer-facing portal only — the internal admin console always stays Seredina-branded (see the One Accent Rule).

## Do's and Don'ts

### Do:
- **Do** compose `Button`/`Input`/`Select`/`Card` for any new control or surface rather than hand-rolling the same Tailwind string again.
- **Do** match the nearest existing arbitrary text-size value when extending a page (The Nearby-Value Rule).
- **Do** add a new entry to `Badge`'s `TONES` map (and `STATUS_CATEGORY_TONE`/`PRIORITY_TONE` if it's a status/priority) rather than inlining a badge color.

### Don't:
- **Don't** introduce a third accent hue outside indigo/violet.
- **Don't** stack more than one `shadow-sm`, or reach for a heavier shadow.
- **Don't** apply `focus:outline-none` without an equivalent `box-shadow`/`ring` focus indicator — several existing spots do this and are being fixed as a known gap, not a pattern to repeat.
