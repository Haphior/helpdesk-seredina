# ADR 0039: Grafana Alerting integration — a named monitoring tool on top of the generic alert channel

## Status

Accepted, implemented.

## Context

Phase 4's monitoring-integration item: "a real, named Zabbix or Grafana
integration with its own setup UI, instead of leaving every NOC/SOC tool
integration as 'here's the generic endpoint, map your own payload.'" ADR
0003 built the generic ingestion point (`POST /v1/alerts`) and deliberately
kept severity-mapping "the integrator's job," to stay tool-agnostic. This
ADR doesn't reverse that — the generic endpoint is untouched and keeps
working for every tool that isn't specifically supported — it adds a
**second, named** endpoint on top of it for Grafana specifically, so
Grafana's own default webhook payload maps automatically with zero
per-tenant configuration on Grafana's side.

**Grafana chosen over Zabbix for this first pass**: Grafana's alerting
webhook payload is a single, stable, well-documented JSON shape (confirmed
by fetching Grafana's own webhook-notifier docs directly, not recalled);
Zabbix's webhook integration instead requires the *tenant* to write a
JavaScript "media type" script that shapes the outgoing payload itself,
which is a fundamentally different integration model — closer to "config
the tenant already has to write" than "a real, named integration Seredina
provides." Zabbix support is a real candidate for a future pass, not
abandoned.

## Decisions

**One ticket per Grafana webhook *call*, not per individual alert inside
it.** Grafana already groups related alerts by `groupLabels` before ever
calling the webhook — a single call's `alerts` array can hold several
individual alerts that share a cause. Treating each *call* as one incident
matches Grafana's own grouping intent; fragmenting it back into one ticket
per array entry would work against that.

**`groupKey` is the `externalId`** ADR 0003's existing dedup logic keys on
— it's stable across the *same* alert group's later firing/resolved calls,
exactly what "fold a re-fired alert into the still-open ticket" needs. A
`resolved` notification for the same group is **not** silently dropped or
auto-closed — it's recorded as a message on the existing ticket (via the
same re-fire path every repeated `firing` call already uses), so a human
agent decides whether "Grafana says this cleared" actually means the
ticket should close. Auto-closing a ticket because a monitoring tool says
so was considered and rejected: that's a real behavior change to `Ticket`
lifecycle semantics, out of scope for what's meant to be "a payload adapter
on top of an existing mechanism," not a new one.

**Severity mapping reads Grafana's own, informal `severity` label
convention** (`commonLabels.severity` — "critical"/"warning"/"info" etc.,
common but not enforced by Grafana itself) onto the existing 5-value scale.
Unrecognized or absent falls through to `undefined`, which `ingestAlert`
already defaults sensibly (`NORMAL` priority) — this adapter never guesses
at a severity it wasn't actually told.

**Title/description prefer Grafana's own customizable `title`/`message`
fields when present, with a synthesized fallback** (built from
`commonAnnotations` and the alert count) when a tenant hasn't customized
their Grafana notification template — meaning the integration works
correctly with Grafana's *default*, un-customized webhook notifier, not
only if a tenant writes a custom template first.

**Same `ApiKey` Bearer auth as `/v1/alerts`/`/v1/tickets`** — confirmed
Grafana's webhook contact point supports a custom `Authorization` HTTP
header in its own settings, so this drops into the exact existing
`authenticateApiKey` preHandler with no new auth mechanism.

**A dedicated `apps/api/src/modules/integrations/` module**, not more
functions bolted onto `modules/tickets/service.ts` — `ingestGrafanaAlert`
wraps `ingestAlert()` (never duplicating its ticket-creation/dedup logic)
and lives in its own small module, matching the roadmap's own framing:
"each one is its own small, real feature — not a platform for arbitrary
future ones." Zabbix, if built later, would get its own sibling file the
same way.

**A real setup UI** (`apps/web/src/pages/MonitoringIntegrations.tsx`,
Administration group) shows the exact webhook URL (with a one-click copy),
the `Authorization: Bearer <key>` header instructions, and a link to the
existing API Keys page rather than duplicating key management — consistent
with this session's own established pattern of reusing an existing feature
instead of rebuilding it.

## Consequences

- **Zabbix is not built in this pass.** A real Zabbix integration would
  need to decide how much of the tenant's own media-type-script burden
  Seredina can actually remove versus Zabbix's own integration model
  fundamentally requiring it — a genuinely different-shaped problem than
  Grafana's, deferred rather than rushed.
- **No automatic ticket resolution from a Grafana "resolved" notification.**
  An operator relying on Grafana to auto-close tickets will find this
  doesn't happen; the resolved notification is visible on the ticket as a
  message, requiring a human to actually change its status. This is a
  deliberate scope boundary, not an oversight.
- **The severity label convention is Grafana's informal one, not something
  Seredina enforces on Grafana's side** — a tenant whose alert rules don't
  set a `severity` label at all gets `NORMAL` priority for everything,
  which may not reflect their actual alert-rule severity if they use a
  different label name or none at all.

## Verified

**`apps/api/test/grafana-integration.test.ts`, 6 tests, live Postgres**:
Grafana's own `title`/`message` fields are used when present; a
synthesized fallback title/description is built correctly when Grafana
sends its unmodified default payload; a `severity: critical` label maps to
`URGENT` priority; no severity label defaults to `NORMAL`; a second
`firing` call with the same `groupKey` folds into the still-open ticket
rather than creating a duplicate; a `resolved` call for the same group is
recorded as a message on the existing ticket, not silently dropped. Full
`apps/api` suite re-run after adding this: 213/213 passing (9 skipped,
unrelated). Both `apps/api`/`apps/web` typecheck clean.

**Real, live, end-to-end against the running dev stack — not mocked**:
registered a real tenant, created a real API key through the real API,
then `curl`-POSTed an actual Grafana-shaped webhook payload (the same JSON
shape Grafana's own webhook notifier sends) to `/v1/alerts/grafana`:
produced a real ticket with the correct subject, `URGENT` priority (from
`severity: "critical"`), `channel: "alert"`, and a `Grafana`-named contact.
Sent a second, `resolved` notification for the same `groupKey` and
confirmed — by fetching the ticket back — it returned the *same* ticket id
and added the resolution as a new message, not a new ticket. Confirmed an
invalid API key is cleanly rejected with `401`.

**Frontend verified live in a browser** (Playwright, real dev stack, with
clipboard permissions explicitly granted to properly exercise the copy
button rather than have it silently no-op under a headless browser's
default clipboard restrictions): the setup page renders the real webhook
URL (built from the same `API_URL` the rest of the frontend already uses,
not a second hardcoded copy), the Grafana section and setup steps render,
and clicking "Copy" both writes the URL to the clipboard and updates the
button label to confirm it. Zero browser console errors.
