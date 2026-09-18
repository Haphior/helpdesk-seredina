# ADR 0030: Ticket Status configuration + first-run onboarding checklist

## Status

Accepted, implemented.

## Context

Continuing the roadmap after the four-section review pass: the remaining
Phase 2 item was "a first-run product tour after signup/first login" — the
roadmap's own suggested checklist included "create your first custom
status." Investigating that surfaced a real, pre-existing gap: **there was
no way to create, edit, reorder, or delete a ticket status anywhere in the
app.** `TicketStatus` (key, label, category, sortOrder) was fully modeled in
the schema, but `ticketStatus.create` was only ever called once, from
`seedDefaultTicketStatuses` at tenant registration. The tour's own premise
depended on a feature that didn't exist, so this ADR covers both: building
the missing CRUD, then the tour itself.

## Decisions

**Ticket Status CRUD landed as its own Configuration page, not folded into
an existing one.** It's tenant-wide configuration at the same `tickets:
manage_all` tier as every other resource in that group, following the exact
create/edit/reorder/delete + sortOrder-swap pattern this session's
Configuration review pass (ADR 0028) already established for Custom Fields
and Escalation Tiers.

**`key` is immutable after creation, and the status whose key is `open` gets
two hard protections `key`'s general immutability doesn't cover on its
own:** it can never be deleted, and its `category` can never be changed away
from `OPEN`. Both are checked server-side (never just a disabled UI control)
because `createTicketFromApi` and `ingestAlert` both look up the tenant's
initial status by the literal key `'open'`, not by category — deleting it
would break ticket creation outright for the whole tenant; recategorizing it
would mean every brand-new ticket immediately counts as pending/resolved/
closed in every SLA calculation and report. Every other status, seeded
default or custom, is fully editable and deletable (deletion blocked only
while tickets are still in it — a plain FK-violation-shaped check with a
friendly message instead of a raw Postgres error).

**The onboarding tour is a Dashboard widget, not a separate flow or a
one-time flag.** The roadmap's own framing suggested this ("pairs naturally
with the dashboard... the first widget you see is literally the tour's
checklist"), and it turned out to need zero new infrastructure:
`WIDGET_TYPES` is a plain array already consulted by the existing
per-user-preference system (`DashboardWidget`, "no row = default"), so
adding `'onboarding_checklist'` at position 0 was the entire integration
cost. Dismissible for free too — it's a widget like any other, so the
existing hide toggle already covers "I'm done with this."

**Checklist items are derived from real tenant data, never a one-time
"did you see this" flag.** An established tenant that already has an SLA
policy, a macro, a customized status, and more than one user has genuinely
finished onboarding whether or not anyone ever opened this widget — so
`getOnboardingChecklist` just queries current state on every load
(`ticketStatus` keys outside the four seeded defaults, `SlaPolicy.count()`,
`Macro.count()`, `User.count() > 1`) rather than tracking progress
anywhere. All four items done renders a single completed state instead of
an empty checklist, so a mature tenant doesn't see a permanently-nagging
widget.

**The four items are the roadmap's own three suggestions (custom status,
macro, SLA policy) plus the one near-universal SaaS-onboarding step it
didn't mention: inviting a teammate** — chosen because a solo admin account
is itself an onboarding gap worth surfacing, and `Users.tsx`'s create-user
flow already existed with nothing more to build.

## Verified

12 new integration tests against real Postgres: 6 in
`apps/api/test/ticket-statuses.test.ts` (create appends after the seeded
defaults; duplicate key rejected; label/category/sortOrder editable while
key stays fixed; the "open" status can't be recategorized away from OPEN or
deleted; a status with tickets in it can't be deleted until they're moved
out; reordering works via the sortOrder-swap pattern) and 6 in
`apps/api/test/dashboard.test.ts`'s new `onboarding checklist` suite (a
fresh tenant with only seeded defaults and one user has every item undone;
each item flips to done independently and only when the tenant actually
does the corresponding real thing, ending in every item done). Full suite
155/155 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean.

Browser-verified end to end via Playwright against the real running app:
registered a fresh tenant and confirmed "Get started" renders as the first
dashboard widget with all four items showing unchecked; on the new Ticket
Statuses page, confirmed all four seeded statuses render with the "open"
row's protective note and no delete button, created a custom status,
edited its label, reordered it, then deleted it, and confirmed "open"
genuinely has no delete control; set a real SLA policy, created a real
macro, and invited a real teammate through their existing pages; reloaded
the dashboard and confirmed the checklist widget now renders its
completed "All set up" state. Zero console errors.

**A cross-cutting fix along the way**: the Configuration nav group hit 11
flat items the moment Ticket Statuses was added (past this app's own
~8-item grouping threshold, already called out in `Layout.tsx`'s own
comment). Split into two groups — **Configuration** (Ticket Statuses,
Custom Fields, Service Catalog, Process Templates, Macros, SLA Policies)
and **Operations** (Webhooks, On-Call & Escalation, Business Hours, AI
Usage, Data Export) — rather than letting an already-flagged problem get
worse in the same change that triggered it.

## Consequences / known v1 limitations

- No way to bulk-migrate tickets off a status before deleting it — an admin
  has to reassign them individually (or in bulk via the existing Tickets
  bulk-edit UI) first; `deleteTicketStatus` just refuses with a count-based
  error rather than offering a "move all N tickets to..." shortcut.
- The onboarding checklist's "customize your ticket statuses" check is a
  presence test (does any non-seeded-key status exist), not a richer
  "did you set up your workflow well" judgment — a tenant that adds and
  then deletes a custom status without keeping any would show that item as
  undone again, which is correct but slightly literal.
- This closes the roadmap's explicit Phase 2 onboarding item for the
  product tour. The setup wizard for self-hosted Docker installs (the
  other onboarding item) is deliberately not addressed here — it has a
  real chicken-and-egg problem (the API process already hard-requires
  `JWT_SECRET`/`ENCRYPTION_KEY` at boot, before any wizard UI could run to
  generate them) that needs its own design pass, not a quick follow-on to
  this one.
