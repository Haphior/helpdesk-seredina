# ADR 0049: Console internationalization (i18n) v1

## Status

Accepted, implemented (partial coverage — see Scope).

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

**Explicitly NOT translated in this pass, named here rather than silently
incomplete**: Tickets Queue and Ticket Detail (790 and large multi-file
surfaces — the single biggest remaining lift, deliberately deferred to its own
follow-up pass rather than rushed), and every other page under Work/CMDB/
Configuration/Operations/Administration (~49 files). The dashboard's onboarding
checklist item text (`"Customize your ticket statuses"`, etc.) is backend-supplied
content from `GET /onboarding-checklist`, not a frontend string — translating it
needs the API to return a locale-aware response (or a client-side key mapping),
a real follow-up distinct from the frontend-string sweep this ADR covers, so it's
still shown in English regardless of the selected UI language.

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
