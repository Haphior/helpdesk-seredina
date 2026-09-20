# ADR 0046: Zabbix integration

## Status

Accepted, implemented.

## Context

`docs/ROADMAP.md`'s Phase 4 named Zabbix explicitly, and ADR 0039 (Grafana) had
already flagged why it wasn't built in that pass: "its integration model (a
tenant-authored JS payload script) is a different shape of problem than Grafana's,
deferred rather than rushed." Unlike Slack/Teams (a real OAuth app registration) or
WhatsApp (Meta Business verification), Zabbix has no external blocker at all — the
"different shape" is architectural, not a dependency on a third party's approval.

## Approach

**Confirmed against Zabbix's own docs, not guessed.** Every macro name
(`{EVENT.ID}`, `{EVENT.SEVERITY}`, `{TRIGGER.NAME}`, `{HOST.NAME}`, `{EVENT.DATE}`,
`{EVENT.TIME}`), the exact severity scale ("Not classified"/"Information"/
"Warning"/"Average"/"High"/"Disaster"), and the webhook script's own shape
(`JSON.parse(value)`, `new HttpRequest()`, `.addHeader()`/`.post()`/`.getStatus()`,
`Zabbix.log()`, throwing a string to report failure) were fetched from Zabbix's
live documentation and its own webhook script examples page — the same "confirmed
live, real, not assumed" bar ADR 0039 held Grafana's payload shape to.

**Why Zabbix needs zero new backend code, unlike Grafana.** Grafana needed a named
`POST /v1/alerts/grafana` endpoint because Grafana's own webhook payload shape is
fixed and not tenant-editable — mapping it required a Seredina-side adapter (ADR
0039's `modules/integrations/grafana.ts`). Zabbix's webhook mechanism is the
opposite: it *always* runs a tenant-configured JavaScript function with full
control over the outgoing request, for every single Zabbix installation, with no
"default payload" concept to speak of. That means the mapping can live entirely on
the Zabbix side, as a script that already produces exactly the shape the existing,
generic, tool-agnostic `POST /v1/alerts` (ADR 0003) expects — so this pass ships a
script and a setup page, not a new route.

**One script, works for every tenant.** The JS pasted into Zabbix's Webhook media
type contains no tenant-specific values — `params.api_url` and `params.api_key`
come from that Media Type's own configured parameters (Zabbix's standard
name→value mechanism, populated from macros like `{EVENT.ID}` or literal text the
tenant fills in), so the same script text is shown to every tenant and every
self-hosted deployment. Severity mapping (`Not classified`/`Information` → `INFO`,
`Warning` → `LOW`, `Average` → `MEDIUM`, `High` → `HIGH`, `Disaster` → `CRITICAL`)
lives inside that script, mirroring Grafana's own `SEVERITY_LABEL_MAP` shape and
reasoning exactly, just with Zabbix's real vocabulary instead of Grafana's informal
label convention.

**Problem-only, via a Zabbix Action condition — not a status macro in the script.**
Zabbix does distinguish "problem" from "resolved" notifications, but which macro
cleanly carries that distinction into a webhook's parameter set is inconsistently
documented across Zabbix's own pages (some sources point at `{EVENT.VALUE}`, others
at `{TRIGGER.STATUS}`, without a single page confirming both the exact macro and its
value semantics together). Rather than guess and risk silently misclassifying a
resolved event as a new problem, this pass sidesteps the ambiguity entirely: the
setup instructions have the tenant restrict their Zabbix **Action** to `Event type
= Problem` — a real, standard, well-documented Zabbix configuration step (not an
obscure workaround) — so a resolved/OK notification simply never reaches the script
in the first place. A future pass could add resolved-event handling once a specific
macro's semantics are verified against a real Zabbix instance rather than docs
summaries alone; named here as a real, deliberate scope cut, not silently dropped.

**UI: one more card on the existing Monitoring Integrations page**, not a new page.
Same structure as Grafana's card (numbered setup steps, a copyable field), plus a
new `CopyableCodeBlock` for the multi-line script — matching the existing
`CopyableField`'s exact clipboard/feedback pattern, not a new one.

## Consequences

- If Zabbix ever needs its own real endpoint (e.g., to accept its native payload
  directly without a script, or to handle resolved events once verified), that's a
  separate, additive change — this pass deliberately didn't build toward a
  hypothetical future shape it can't confirm yet.
- The webhook script's syntax was checked (`node --check`) but never executed
  inside a real Zabbix instance in this sandbox — Zabbix's JS engine and its
  `HttpRequest`/`Zabbix` globals aren't available outside Zabbix itself. Disclosed,
  not hidden: the actual HTTP call it makes was verified for real by POSTing the
  exact JSON body the script would produce directly to the running dev API (below).

## Verified

No new backend code, so no new automated tests — the generic `/v1/alerts` endpoint
and its severity→priority mapping, re-fire folding, and RLS scoping are already
covered by `apps/api/test/grafana-integration.test.ts` and the alert-ingestion
suite. What's new here (the script + setup page) was verified directly: the
embedded script's JS syntax was checked with `node --check`. Live, against the real
running dev API: created a tenant and a real API key through the actual UI/API,
then `curl`-POSTed the exact JSON body the script would produce for a "Disaster"
severity Zabbix problem — got back a real `201`, `priority: "URGENT"` (confirming
the severity map), `channel: "alert"`. A second POST with the same `externalId`
returned the identical ticket `id`/`number` (the re-fire fold, unchanged from
Grafana's/alert-ingestion's existing behavior). Live in a browser: the new Zabbix
card renders correctly on `/monitoring-integrations` alongside Grafana's, and its
**Copy** button was exercised for real (not just visually) — clicked, then the
clipboard's actual contents were read back and confirmed to contain the real
script. Zero console errors.
