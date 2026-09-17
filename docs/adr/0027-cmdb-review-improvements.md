# ADR 0027: CMDB review pass — asset detail page, search/filter/pagination, style parity

## Status

Accepted, implemented.

## Context

The second section of the user's requested review-then-fix pass, applying
the same four lenses (UX/flow, missing functionality, bugs/tech debt,
performance) to the CMDB nav group (Assets, Equipment Catalog, Services).

## Decisions

**`Assets.tsx` gets the same visual-language pass every other page already
had.** It was still on the pre-refresh styling (`p-6`, `text-2xl
font-semibold`, `rounded-md`, `text-red-600`, a plain HTML `<table>`) while
its own sibling, Equipment Catalog, was already on the current one
(`px-8 py-7`, `text-[22px] font-extrabold`, `rounded-xl`, `text-rose-600`,
a `divide-y` row layout). Rewritten to match, using the same grid-row
pattern `TicketsQueue.tsx` already established for a filterable, clickable
list.

**Assets gained real search (`q`, matching name/IP/hostname) and pagination
(`limit`/`offset`/`total`), plus type/status filters** — the exact same gap
the Work section review found on Tickets/Problems/Processes/KB, just not
yet applied here. Same defaults (limit 50, max 200) for consistency.

**A real asset detail page now exists, using a backend endpoint that
already did the work.** `GET /assets/:id` already returned linked tickets;
nothing in the UI ever called it — a genuinely half-finished feature. Also
added `services` to `getAsset`'s return (flattened from the `ServiceAsset`
join the same way `getTicket` already flattens its own asset→services
list), so the detail page can show both directions: which tickets reference
this asset, and which business Services it underpins. Reachable by clicking
an asset row, matching how every other list-with-detail page in this
codebase already works (Tickets, Problems, Processes).

**A failed discovery scan now shows why.** `DiscoveryJob.errorMessage` was
already captured by the worker on failure and already typed on the frontend
-- it just had no `<span>` to render it. One-line fix.

**Fixed a pagination regression the Assets pagination change itself
introduced**: `TicketDetail.tsx`'s and `Services.tsx`'s "link an asset"
pickers called `GET /assets` with no params, which used to mean "give me
everything" and now means "give me the first 50." Both now explicitly pass
`?limit=200` (the max) — a tenant with more assets than that would need a
real search-based picker in those two spots eventually, the same
already-documented limitation as the Problem-detail ticket picker (ADR
0026).

**Equipment Catalog and Services were left alone.** Equipment Catalog was
already on the current design language with no functional gaps found — a
small reference list, no pagination need at realistic catalog sizes.
Services was reviewed as part of the public-status-page work (ADR 0025)
already; nothing new surfaced here.

## Verified

5 new integration tests against real Postgres (`apps/api/test/assets.test.ts`):
search matches name/IP/hostname case-insensitively; `assetType`/`status`
filters work independently; limit/offset page correctly with an accurate
`total`; `getAsset` returns both the linked tickets and the services an
asset underpins; an asset with no links reports empty arrays, not an error.
Full suite 133/133 passing (9 skipped, unrelated), both `apps/api`/`apps/web`
typecheck clean.

Browser-verified end to end via Playwright: registered a tenant, built a
CMDB fixture (a server linked to both a Service and a Ticket, plus an
unrelated retired workstation and an unlinked printer) via the authenticated
API, then confirmed in the real running app: the search box correctly
finds-and-hides by name; the status filter correctly isolates the retired
asset; clicking an asset row opens its detail page showing the real linked
ticket and the real linked service. Also visually confirmed (screenshot)
that the restyled list and new detail page render cleanly and match the
rest of the app — including catching and fixing a truncation issue in the
first pass (the Name column was too narrow for a realistic hostname-length
asset name; widened at the expense of the less-critical Source/Last-seen
columns). Zero console errors.

## Consequences / known v1 limitations

- The "link an asset" pickers in `TicketDetail.tsx` and `Services.tsx` cap
  at 200 assets, not a real search-based picker — same class of limitation
  as ADR 0026's ticket picker.
- No bulk actions on the Assets list (bulk status change, bulk delete) —
  Tickets has this via `TicketsQueue.tsx`'s selection UI; Assets doesn't yet.
  Not requested by this review pass; noted for a future one.
- No CSV import for bulk-adding assets by hand — agentless discovery and
  one-at-a-time manual entry are the only ways in today.
