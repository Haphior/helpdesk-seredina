# ADR 0025: Public status page, auto-driven by Service Configuration Management + the alert channel

## Status

Accepted, implemented.

## Context

The third and final of this pass's three differentiators. Atlassian sells this
as a separate product (Statuspage) on top of Jira Service Management; GLPI and
ServiceDesk Plus don't offer it at all. The roadmap flagged the real work up
front as a privacy/scoping decision, not a technical one: deciding exactly
what an anonymous visitor is allowed to see.

## Decisions

**No new table.** A Service's status is derived, at request time, from data
that already exists for other reasons: which `Asset`s an agent has linked to a
`Ticket` (the `TicketAsset` join, same mechanism the CMDB already uses
everywhere), joined through `ServiceAsset` (Service Configuration Management,
ADR 0017) to find which Services those Assets underpin. "Zero manual
maintenance" means literally that — nothing to publish, nothing to toggle;
the page just reflects current ticket/asset state.

**Scoped to `channel: 'alert'` tickets only, not "any open ticket linked to
this asset."** A routine "replace this keyboard" support ticket tagged with an
asset shouldn't flip a public status page to degraded — only incidents that
came in through the monitoring/SIEM integration (`POST /v1/alerts`, ADR 0003)
count. `ingestAlert` itself doesn't auto-link an asset to the ticket it
creates; an agent tags the incident with the affected asset from the ticket
detail page's existing Assets panel, the same action already used for every
other CMDB linkage. This is deliberate, not a gap: Seredina doesn't try to
guess an asset from an alert payload's IP/hostname in v1.

**Three status levels, derived from ticket priority, not a fourth data
field.** `operational` (no open alert-linked incidents), `degraded` (open
incidents, all `LOW`/`NORMAL` priority), `outage` (at least one `HIGH`/
`URGENT` incident). The tenant-wide banner takes the worst level across all
services. No new enum or config — priority is a field that already exists on
every ticket for an unrelated reason (SLA routing), reused here as the signal.

**The privacy/scoping decision: a service name and a status, plus a bare
incident *count* — never a ticket subject, description, or any Asset detail
(hostname, IP, asset type).** `getPublicStatusPage`'s return shape is a
narrow, purpose-built projection (`{ id, name, status, openIncidents }`) built
fresh in the service layer, not a `select` trimmed off the real `Ticket`/
`Asset` models — there's no field on that return type a future change could
accidentally widen into something sensitive, because the type simply has no
room for it. Verified in both the integration tests (string-search the
exported JSON for the ticket's actual subject text) and the browser
verification pass below.

**No auth, same posture as the KB public portal (ADR 0018).** An anonymous
visitor checking "is it down for everyone" has no Seredina account.
`GET /public/:tenantSlug/status` resolves the tenant via the same
`resolveTenantIdBySlug()` login/register/the KB portal already share, and
404s for an unknown slug exactly like the KB portal does.

**The internal Services admin page gained a one-line hint** pointing at the
tenant's own `/status/:tenantSlug` URL (fetched via `/auth/me`, mirroring
`KnowledgeBase.tsx`'s identical pattern for its own public portal link) —
discoverability, not new functionality.

## Verified

6 new integration tests against real Postgres
(`apps/api/test/public-status.test.ts`): a service with no linked incidents
reports `operational`; an open `alert`-channel ticket at `LOW`/`NORMAL`
priority reports `degraded` and bumps the tenant-wide `overall`; a `HIGH`/
`URGENT` one reports `outage` and bumps `overall` further; a non-`alert`
channel ticket linked to the same asset is ignored regardless of priority;
closing the alert ticket returns the service to `operational`; a second
tenant's incidents never leak into this tenant's page. Full suite 118/118
passing (9 skipped, unrelated), both `apps/api`/`apps/web` typecheck clean.

Browser-verified end to end against the real running app: registered a fresh
tenant, created an asset and a service and linked them via the authenticated
API (the same calls the Services page itself makes), fired a real
`POST /v1/alerts` with `severity: 'CRITICAL'` through an API key (simulating
an actual monitoring tool), tagged the resulting ticket with the asset from
the ticket-detail linkage endpoint, then confirmed: the internal Services
page's hint now shows the real `/status/<slug>` URL; and — in a separate,
unauthenticated browser context — the public status page shows "Major outage
affecting one or more systems," lists "Email" as "Outage (1 active
incident)," and **critically, the alert's own title ("Mail server
unreachable") never appears anywhere in the public page's rendered text** —
confirming the privacy/scoping decision holds through the real HTTP response,
not just the service-layer return type. Zero console errors.

## Consequences / known v1 limitations

- No historical incident timeline (past outages, resolution times) — this is
  a live snapshot only, matching Statuspage's "current status" view but not
  its history/timeline view.
- No subscribe-to-updates (email/RSS) for status changes — a plausible future
  addition, not committed to here.
- `ingestAlert` still doesn't auto-link an asset from the alert payload
  (matching by IP/hostname/externalId) — an agent must tag the incident
  manually for it to appear on the status page at all. A tenant that never
  links assets to alert tickets gets a status page that's always green,
  which is a real gap to flag to a self-hoster, not a bug.
- No way to manually mark a service as degraded/down independent of ticket
  state (e.g. planned maintenance) — the page is purely derived, with no
  override.
