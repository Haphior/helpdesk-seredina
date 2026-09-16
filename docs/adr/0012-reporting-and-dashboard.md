# ADR 0012: Reporting v1 and the dashboard — in-JS aggregation, per-user widget prefs, no charting library

## Status

Accepted, implemented.

## Context

The last item carried in Phase 2 since the original planning pass, expanded partway through this session at the user's explicit request into "an interactive, configurable home dashboard with stats and charts" rather than just a reporting API. Two real questions: how much aggregation infrastructure this actually needs at real helpdesk volumes, and what "configurable" concretely means without building a full drag-and-drop layout engine for a first pass.

## Decisions

**Aggregation happens in JavaScript after one `findMany`, not SQL `GROUP BY`.** Every function in `modules/reporting/service.ts` (ticket volume, priority breakdown, SLA compliance, agent workload, channel breakdown) pulls the relevant rows through the normal `withTenantTx` path and buckets/counts them in a loop. This is a deliberate scope cut, not an oversight: it's simpler, keeps every query going through the same RLS-gated path as the rest of the codebase, and is fine at the ticket volumes a single tenant actually generates. Revisit with real SQL aggregation only once a tenant's volume makes the in-JS grouping a measured cost, not ahead of that signal.

**Configurable means show/hide and reorder, not free-form drag-and-drop positioning.** `DashboardWidget` (tenant + user scoped: `widgetType`, `sortOrder`, `visible`) follows the same "no row = default" shape `SlaPolicy` already established — a widget type with no row shows at its built-in default position and stays visible. Reordering is implemented as swapping `sortOrder` between two adjacent widgets (two `PUT` calls), not a pixel-position grid; a real drag-and-drop layout library is a legitimate future upgrade but wasn't worth adding for a first pass with exactly five widget types. Preferences are per-**user**, not per-tenant: two agents at the same tenant can hide or reorder differently, which is why `DashboardWidget.userId` exists at all instead of collapsing into `Tenant`-level settings.

**No charting library.** The ticket-volume bar chart is a `<svg viewBox="0 0 100 40" preserveAspectRatio="none">` with one `<rect>` per day, height scaled to the period's max — about 15 lines, no new dependency, and it's the same "hand-roll simple SVG rather than pull in a library" approach already used for the logo mark this session. The other four widgets are progress bars and lists built from existing `Badge`/color tokens, not charts at all.

**Fixed widget catalog, not a plugin surface.** `WIDGET_TYPES` is a hardcoded array of five strings (`ticket_volume`, `priority_breakdown`, `sla_compliance`, `agent_workload`, `recent_activity`), validated with zod at the route layer — the same "fixed set, checked at the boundary, no DB enum" posture used everywhere else in this codebase. Adding a sixth widget type is a code change, not a tenant-configurable extension point; that's intentional, matching the "integrations, not a plugin platform" decision already made elsewhere in `docs/ROADMAP.md`.

**The dashboard is now the default landing page.** `/` redirects to `/dashboard` instead of `/tickets`, and both `Login.tsx` and `Register.tsx`'s post-auth `navigate()` calls were updated to match — both had hardcoded `/tickets` that bypassed the `/` redirect entirely, caught only because the first browser verification pass landed on the wrong page.

## Verified

10 new integration tests against real Postgres (`test/reporting.test.ts`, `test/dashboard.test.ts`): ticket volume buckets by creation day including empty days, priority breakdown excludes closed tickets, SLA compliance correctly splits met-vs-breached by comparing `resolvedAt` to `resolutionDueAt` and excludes tickets with no target or not yet resolved, agent workload groups by assignee and counts unassigned separately while excluding closed tickets, channel breakdown counts correctly, recent activity orders by `updatedAt` descending and respects its limit. Dashboard prefs: no rows returns every widget visible at its catalog-order default, hiding one widget doesn't affect others, reordering changes the returned order, an unknown widget type is rejected. Full suite 39/39 green, both `apps/api` and `apps/web` typecheck clean.

Browser-verified end to end against the real running app and real demo data: login now lands on `/dashboard` (was `/tickets` until the hardcoded redirects above were caught and fixed), all five widgets render with real aggregated data — a ticket-volume bar chart with a real spike on the days this session's demo tickets were created, a priority breakdown with real counts, an honest "No resolved tickets with an SLA target yet" empty state (accurate — no demo ticket has actually been resolved after receiving an SLA target), an agent-workload bar showing 4 unassigned, and a recent-activity list linking to real tickets with correct status badges. Hid a widget, reloaded the page, and confirmed it stayed hidden — proving the per-user persistence actually round-trips through the API rather than just updating local state. Zero console errors.

## Consequences / known v1 limitations

- No SQL-level aggregation yet — see the in-JS decision above; a real cost signal, not a deadline, is what should trigger revisiting this.
- No true drag-and-drop grid positioning — show/hide and linear reorder only.
- No date-range picker on the ticket-volume widget (fixed at the last 14 days) or configurable thresholds on any widget.
- The five widget types are the only ones that exist; adding another (e.g. CSAT once that ships, or asset counts once Asset Management has enough data as the original roadmap note anticipated) is a code change each time, not a self-serve addition.
