# ADR 0017: Service Configuration Management — a many-to-many over existing Assets

## Status

Accepted, implemented.

## Context

Last item explicitly named in the ITIL/competitive-pass section of Phase 2's
roadmap. Sharper than the general "CMDB relationship depth" concern already
flagged in Phase 1/2: this is the ITIL practice of mapping which technical
**Assets** actually underpin which business-facing **Service** ("Email,"
"Payroll"), not just asset-to-asset or asset-to-contact links. It also
directly unblocks a differentiator already sketched in the roadmap's
Differentiators section — a public status page driven by `Service`→`Asset`
links plus the alert channel — without that feature needing to be built now.

## Decisions

**A new `Service` model plus an explicit `ServiceAsset` join table**, not a
field on `Asset`. One Service can depend on several Assets (e.g. "Email"
needs both the mail server and the DNS box), and one Asset can underpin
several Services (a shared database server) — a genuine many-to-many, so a
single nullable `Asset.serviceId` would have been wrong from the start. The
join table mirrors `TicketAsset`'s exact shape (composite primary key,
denormalized `tenant_id` for the same RLS reason noted at the top of
`schema.prisma`) rather than inventing a different join-table convention for
this one relation.

**`Service` itself is deliberately minimal**: `name` and `description`, full
stop. No status field, no owner, no SLA target. The roadmap's own status-page
sketch already settles what "current status" should mean here — derived at
read time from which Services have an open `channel: 'alert'` ticket right
now, not a manually-maintained field that would drift from reality the first
time nobody remembers to update it. Storing a status on `Service` now would
have meant either leaving it permanently unused or building half of the
status-page feature as a side effect of this one — both worse than leaving
it out until that feature is actually built.

**Surfacing "this affects: Payroll" reuses the existing ticket↔asset link,
not a new ticket-level field.** `getTicket`'s asset include now also pulls
each linked asset's `ServiceAsset` rows and flattens them to a plain
`services: {id, name}[]` per asset in the service layer — the frontend never
needs to know a join table exists. A ticket already shows which assets it's
about (`TicketAsset`, existing); this makes that same list also show which
business services those assets underpin, entirely from data that already
exists once a tenant has done the Service↔Asset mapping. No change to how a
ticket gets linked to an asset in the first place.

**Permission tiers mirror the rest of the CMDB (`modules/assets`) exactly**:
`assets:read` to browse services, `assets:manage` to define one or change
what underpins it. Service Configuration Management is CMDB configuration,
not day-to-day ticket work, so it sits at the same tier as Asset CRUD and the
Equipment Catalog, not the ticket-write tier.

## Verified

7 new integration tests against real Postgres
(`apps/api/test/services.test.ts`): creating a service rejects a duplicate
name; linking two assets to a service lists both back; one asset can
underpin more than one service simultaneously; unlinking removes the
join row without deleting either the asset or the service; linking a
nonexistent asset or service is rejected with the correct message for each;
a ticket linked to an asset that underpins a service shows that service in
`getTicket`'s flattened `asset.services`; deleting a service works and a
second delete is rejected. Full suite 65/65 passing (9 skipped, unrelated),
both `apps/api`/`apps/web` typecheck clean.

Browser-verified end to end against the real running app: added two assets,
created a Service ("Email") and linked both to it, created a ticket via the
API-key path, linked its affected asset from the ticket's own "Linked
assets" panel, and confirmed "Affects: Email" renders correctly right there
— using data entered entirely through the new Services admin page, with no
other code path touched. Zero console errors.

## Consequences / known v1 limitations

- No derived "current status" for a Service yet (e.g. "degraded," "down") —
  as decided above, that's the public-status-page differentiator's job, not
  this ADR's; nothing here needs to change to build it later, since the
  `Service`→`Asset` link is exactly what that feature was designed to
  consume.
- No cascading "affects" beyond one hop — a Service that depends on an Asset
  that itself depends on another Asset (a real dependency chain) isn't
  modeled; every Service↔Asset link is direct.
- No bulk asset-to-service assignment — each link is added one at a time
  from either the Services admin page, matching every other link-one-at-a-
  time control already in this codebase (ticket↔asset, process↔change).
