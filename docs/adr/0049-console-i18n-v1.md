# ADR 0049: Console internationalization (i18n) v1

## Status

Accepted, implemented (partial coverage — see Scope). Extended same-day to cover
Tickets Queue and Ticket Detail (see "v1.1" below) — the two screens explicitly
named as the next-highest-priority gap when v1 shipped.

## Context

`docs/ROADMAP.md`'s backlog named console i18n as real follow-up work, added
2026-09-21 alongside the Slack/Teams/WhatsApp re-scoping. Two open questions were
left for whoever picked it up: which library, and how much of the app to cover in
the first pass.

## Approach

**Library: `react-i18next` over a homegrown key→string map.** Seredina has real
pluralization/interpolation needs already visible in the UI (`"{{count}} met"`,
`"{{total}} resolved"`), and `react-i18next` is the standard, well-supported choice
for a React app — `useTranslation()`'s `t()` function, JSON resource files per
language, browser-language detection, all with a small footprint (`i18next` +
`react-i18next`, no build-step changes needed since Vite handles JSON imports
natively).

**Per-user, not per-tenant.** Unlike the UI theme system (ADR 0042, tenant-wide —
warmth/mood is a brand choice), language is an individual's own preference: a
tenant may have both English- and Spanish-speaking agents. Stored in
`localStorage` only for v1 (`seredina.language` key), not a backend column — a
deliberate, disclosed scope cut matching the "browser storage for a per-viewer
convenience" pattern already used elsewhere in this app, with one caveat: this
preference doesn't sync across devices, unlike a true per-user server-side
setting. Detection order: stored preference → `navigator.language` → English
fallback.

**Two languages at launch, not just scaffolding.** English (existing copy, moved
into `en.json` as the source of truth) and Spanish (`es.json`) — a real second
language ships now, not merely an i18n-ready shell with one locale, so a
community contributor adding a third language has a working second example to
copy, not just a framework.

## Scope: highest-traffic screens first, not the whole app

Full extraction across all ~54 pages in one pass was judged too large for a
single session — the same "highest-traffic screens first, rest flagged as a
follow-up" phasing this project already used for `docs/DESIGN_SYSTEM.md`'s
original rollout (Tickets/Ticket Detail/Login/Register got the design pass first;
everything else was named "not yet reviewed" rather than silently left inconsistent).
**v1 covers**: Login, Register, `AuthLayout` (the shared shell for both), the
sidebar navigation (`Layout.tsx` — all 5 nav groups, all 27 nav item labels, the
logout button), and the Dashboard (title/subtitle, all 7 widget labels, every
widget's own empty-state/summary copy). This is the first thing every
visitor/prospect sees (auth), the persistent chrome every logged-in session sees
(nav), and the default landing page (dashboard) — not exhaustive, but not
cosmetic either.

**Explicitly NOT translated in v1, named here rather than silently
incomplete**: Tickets Queue and Ticket Detail (790 and 954 lines, the two
largest single-page surfaces in the app — covered same-day, see "v1.1" below),
and every other page under CMDB/Configuration/Operations/Administration (~49
files, still open). The dashboard's onboarding checklist item text
(`"Customize your ticket statuses"`, etc.) is backend-supplied content from
`GET /onboarding-checklist`, not a frontend string — translating it needs the
API to return a locale-aware response (or a client-side key mapping), a real
follow-up distinct from the frontend-string sweep this ADR covers, so it's
still shown in English regardless of the selected UI language.

## v1.1 — Tickets Queue and Ticket Detail (same day)

Extended coverage to the two highest-traffic screens agents actually live in
day to day: `TicketsQueue.tsx` (tabs, search, assignee/priority filters, saved
views, bulk-edit bar, the ticket table, the New Ticket modal's blank and
catalog-request forms) and `TicketDetail.tsx` (header badges, merge/macro/
AI-summarize/autonomous-run controls, the escalation banner, the message
composer, the Details sidebar, the Merge modal). Added a `common.*` locale
namespace (`cancel`, `loading`, `save`/`saving`, `create`/`creating`, `remove`,
`link`, `unassigned`) once it became clear both ticket screens — and any future
one — repeat the same handful of generic verbs many times over; feature-specific
copy stays under `tickets.*` (queue) and `ticketDetail.*` (detail/merge modal).

Two things deliberately stayed untranslated, consistent with the v1 decision
already made for the Dashboard's priority badges: **ticket priority values**
(`LOW`/`NORMAL`/`HIGH`/`URGENT`) and **ticket status labels** — the latter are
tenant-configured data (`TicketStatus.label`, editable per tenant in Ticket
Statuses), not frontend copy, so they can't be looked up in a static locale
file at all. Same reasoning applies to custom field labels, macro names, team
names, and service catalog item names throughout both screens — all tenant
data, correctly left as-is.

**A real i18next pluralization case**: the "AI cost" tooltip
(`"N AI call(s) on this ticket"`) uses i18next's built-in `_one`/`_other` key
suffixes (`aiCallsTooltip_one`/`aiCallsTooltip_other`) driven by a `count`
interpolation value, rather than a hand-rolled ternary — the first real plural
string in the app now used this mechanism instead of the manual
`` `${n} thing${n === 1 ? '' : 's'}` `` pattern still used for other counts.

**A naming collision to watch for**: both files had loop variables named `t`
(the tab being rendered in `TicketsQueue.tsx`, the team in `TicketDetail.tsx`'s
sidebar, the ticket in `MergeModal`'s candidate list) that would have silently
shadowed `useTranslation()`'s own `t` the moment it was introduced — TypeScript
does catch the resulting "not callable" error at compile time (the shadowed
`t` has a non-function type), but only once `t(...)` is actually called
somewhere in that shadowed scope, so it's easy to rename late and miss a spot.
Renamed to `tabItem`/`team`/`tk` at each site before wiring in translations,
worth flagging for whoever does the next batch of pages since this project's
existing code leaned on `t` as a natural single-letter name for "the current
tab/team/ticket" in several places.

## Files

- `apps/web/src/i18n/index.ts` — i18next init, language detection/persistence,
  `setLanguage()`.
- `apps/web/src/i18n/locales/{en,es}.json` — resource files, namespaced by
  feature (`auth.*`, `nav.*`, `dashboard.*`).
- `apps/web/src/components/LanguageSwitcher.tsx` (new) — a `<select>` in the
  sidebar footer, above the user/logout row.
- `apps/web/src/components/icons.tsx` — added `GlobeIcon`.
- `apps/web/src/main.tsx` — imports `./i18n` once at startup.
- `apps/web/src/pages/Login.tsx`, `Register.tsx`, `Dashboard.tsx`,
  `apps/web/src/components/Layout.tsx` — converted to `useTranslation()`.
  `Layout.tsx`'s `navGroups` array changed from hardcoded `label` strings to
  `labelKey`/`itemKey` fields resolved through `t()` at render time.
- `apps/web/src/pages/TicketsQueue.tsx`, `TicketDetail.tsx` (v1.1) — converted
  to `useTranslation()`; `TABS` array changed from `label` to `labelKey` the
  same way `navGroups` did.
- `apps/web/src/i18n/locales/{en,es}.json` (v1.1) — added `common.*`,
  `tickets.*`, `ticketDetail.*` namespaces.

## Consequences

- Adding a third language is: add `locales/xx.json` (copy `en.json`'s keys),
  add `xx` to `SUPPORTED_LANGUAGES` in `i18n/index.ts`, add its label to the
  `language.*` keys in both existing locale files — no code changes beyond that
  for the screens already covered.
- The remaining ~49 pages need the same `useTranslation()` + locale-key
  treatment; Tickets Queue/Ticket Detail should be their own pass given their
  size, not folded into a "finish i18n" one-liner.
- If a future pass wants per-user server-side persistence (so language follows
  a user across devices), that's a new column on `User` plus a settings
  endpoint — not built now since `localStorage` covers the common case (one
  person, one browser) at zero backend cost.

## Verified

`npx tsc --noEmit` and `npm run build` both clean on `apps/web`. Live, against
the real running dev stack: registered a real tenant, confirmed Register/Login/
Dashboard/nav render in English by default (browser-locale fallback), switched
to Spanish via the sidebar selector and confirmed every covered string re-rendered
immediately (nav groups, all widget labels/empty-states, dashboard title), reloaded
the page and confirmed the Spanish choice persisted via `localStorage`, logged out
and confirmed the Login page also rendered in the persisted language. Zero
console errors (one real bug caught and fixed during this verification, see
below) — Playwright screenshots of the Spanish dashboard and login page.

**v1.1 verification**: `npx tsc --noEmit` and `npm run build` clean after the
Tickets Queue/Ticket Detail changes; full `apps/api` suite 282/282 (one
`ai-usage.test.ts` timeout was confirmed flaky by re-running it alone — that
file is untouched by this change, backend-only, unrelated to the frontend
i18n work). Live, against the real running dev stack with genuinely
real created tickets (not fixtures): registered a tenant, created tickets
through the actual "New ticket" modal, confirmed the queue table (tabs, search,
filters, column headers, bulk-select) and a real Ticket Detail page (header
badges, macro/summarize/AI-run buttons, Details sidebar, message composer)
both render correctly in English; switched to Spanish and confirmed the same
ticket's detail page re-rendered every covered string correctly with live
data (`"prioridad NORMAL"`, `"Fusionar en…"`, `"Sin asignar"`, `"Vincular un
activo…"`, etc.); filtered the Spanish queue by tab and search text and
confirmed the `"{{count}} de {{total}}"` counter updated correctly; created
and persisted a real Saved View in Spanish and confirmed it round-tripped
through the actual API and re-rendered as a chip. Zero console errors across
every run. Playwright screenshots of the Spanish queue table (filtered and
with a saved view) and both languages' Ticket Detail pages.

**Bug caught during verification**: the first live-verification run showed a
React "Invalid hook call" / `Cannot read properties of null (reading
'useContext')` crash on the Register page. Not a code defect — the Vite dev
server process had been running since before `react-i18next` was installed, so
its dependency pre-bundling cache (`node_modules/.vite`) still referenced a stale
module graph. Restarting the dev server (which triggers Vite's dep
re-optimization) resolved it with zero code changes; re-ran the full verification
afterward with zero console errors. Documented here as a recurring class of
false-positive bug in this project's fragile dev-environment (see the "Dev
environment resets" note in project memory) — worth checking before assuming a
new dependency broke something.
