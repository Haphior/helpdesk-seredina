# ADR 0021: Saved views — a filter is just serialized query params under a name

## Status

Accepted, implemented.

## Context

"Small, but it's the kind of daily-friction item that showed up repeatedly
in the 'what do helpdesk agents actually need' research pass" — "My open
tickets," "Unassigned + urgent" as a named, reusable filter an agent saves
once instead of rebuilding every session.

## Decisions

**`ListTicketsFilter` gained `assigneeId` and `priority`, not just the
existing `statusCategory`** — without real filter dimensions beyond the
status tabs already on the Tickets page, there was nothing meaningful for a
saved view to capture. `assigneeId` accepts either a real user id or the
literal string `'unassigned'` (meaning `assigneeId IS NULL`), the same
pattern already established for `TicketAsset`/`CustomFieldDefinition`-style
sentinel values elsewhere in this codebase.

**No `'me'` sentinel for "assigned to me."** A saved view is only ever read
back by the user who created it (`SavedView.userId`, enforced at every
service function) — baking the creator's own real user id into
`filters.assigneeId` at save time already means exactly the same thing a
`'me'` sentinel resolved at apply-time would, without needing that second
resolution step anywhere the filter is consumed. The *frontend's* filter
dropdown still labels the option "Assigned to me" for the person building
the filter, using their own `payload.sub` from the JWT — the sentinel-free
design is purely a backend/storage simplification, invisible to how the
feature reads to an agent.

**Per-agent (`userId`), not tenant-wide, mirroring `DashboardWidget`'s
existing shape exactly** — same reasoning: a filter named "My open tickets"
is only meaningful to the person who defined "my." `deleteSavedView`
resolves the row within the tenant first (RLS/`withTenantTx` already
prevents cross-tenant access) and *then* checks `existing.userId === userId`,
rejecting a mismatch with the same `'saved view not found'` message a
genuinely-missing id would get — a caller should never be able to
distinguish "doesn't exist" from "exists, but isn't yours" by response
shape, the same posture already established for the Knowledge Base's
public routes (ADR 0018).

**`filters` is a validated-at-the-service-layer jsonb blob, not a column per
filter dimension** — consistent with `Ticket.customFields` and every other
"tenant/user-shaped, not schema-shaped" value in this codebase. Adding a
fourth filter dimension later (e.g. `channel`) means widening the zod schema
and the `ListTicketsFilter` interface, not a migration.

**Uniqueness is `(userId, name)`, not `(tenantId, name)`** — two different
agents both naming a view "My open tickets" is the expected common case, not
a collision to prevent.

## Verified

5 new integration tests against real Postgres (`apps/api/test/savedviews.test.ts`):
creating a view scopes it to the caller and rejects a duplicate name for
that same user; the identical name is fine for a different user (uniqueness
is per-user); `listSavedViews` never returns another user's views; deleting
another user's view is rejected as not-found (not forbidden), while the real
owner can delete it; a view's stored filters actually narrow `listTickets`
when applied — covering `statusCategory`, a real `assigneeId`, and the
`'unassigned'` sentinel. Full suite 96/96 passing (9 skipped, unrelated),
both `apps/api`/`apps/web` typecheck clean.

Browser-verified end to end against the real running app: created three
tickets at different priorities via the API-key path, filtered the queue to
URGENT only, saved that filter as "Urgent stuff," cleared the filters and
confirmed the full list came back, re-applied the saved view by clicking its
chip and confirmed it narrowed back to URGENT only, then deleted the chip
and confirmed it disappeared. Zero console errors.

## Consequences / known v1 limitations

- No sharing a saved view with teammates — strictly personal, matching the
  roadmap's own "per agent" framing.
- No reordering of saved-view chips beyond creation order (`sortOrder` is
  assigned once, at creation, and never edited).
- Only three filter dimensions (`statusCategory`, `assigneeId`, `priority`)
  — no channel, team, or free-text search yet; the Tickets page's search box
  is still a visual placeholder, unrelated to this feature.
