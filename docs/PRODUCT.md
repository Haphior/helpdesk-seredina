# Seredina — Value, Pain, ICP

This fills the "define value, pain, ICP" gap flagged in a project checklist review.
It's derived from the scoping decisions already made and recorded in
`docs/ROADMAP.md`'s "Vision expansion" section (NOC/SOC = integrate not build,
agentless inventory prioritized, driven by product competitiveness rather than an
internal need) — not from external customer interviews or market research. Treat it
as the team's working thesis, revisit it once real users exist, not as validated fact.

## ICP (Ideal Customer Profile)

**Primary**: small-to-mid-sized IT teams (internal IT at a 20-500 person company, or
an MSP managing several clients) who currently run — or are evaluating — an
open-source ITSM tool (GLPI, osTicket) or a lightweight helpdesk (Zammad, Freescout)
and are outgrowing it, but for whom Zendesk/Freshdesk/Jira Service Management are
either too expensive, too support-ticket-only (lacking ITAM/CMDB), or an unwanted
vendor lock-in.

**Secondary**: developers/technical founders who want a helpdesk they can self-host
under a real open-source license (AGPL, not source-available-with-an-asterisk) and
who value that the same codebase can later become a hosted product for their own
customers without a rewrite.

**Explicitly not the primary target (for now)**: Infraplast's own internal IT
operations — this project is driven by product-market competitiveness, confirmed
explicitly during scoping, not by replacing FlexLine's helpdesk internally. See
[[project-erp-industrial]] for the *other* project that exists for that purpose.

## Pain

1. **Open-source ITSM tools (GLPI) have the feature breadth but a dated,
   utilitarian UX** — agents and end users notice, and it hurts adoption even when
   the feature list checks every box.
2. **Commercial helpdesks (Zendesk, Freshdesk) have the UX but not the ITAM/CMDB
   breadth**, and treat AI as a paid add-on bolted onto a closed platform — you
   can't inspect, self-host, or extend how it reasons about your tickets.
3. **NOC/SOC tools (Zabbix, Wazuh) generate alerts that have to land somewhere a
   human actually works** — most ITSM tools treat "receive a monitoring alert" as
   an afterthought integration, not a first-class ticket-creation channel.
4. **Wanting both self-hosted control and a hosted/cloud option** usually means two
   different products, or a vendor who only offers one. Teams that start
   self-hosted and later want to offload ops (or vice versa) hit a wall.

## Value proposition

Seredina is a single AGPL-3.0 codebase that is simultaneously:

- **A helpdesk with a modern UX** (see `docs/DESIGN_SYSTEM.md`) instead of the
  utilitarian feel typical of open-source ITSM tools.
- **GLPI-scope ITSM/ITAM** (ticketing, CMDB, agentless inventory — see
  `docs/adr/0002-agentless-discovery.md`) without GLPI's UX debt.
- **AI-native, not AI-bolted-on**: pluggable LLM provider adapters, a copilot mode,
  and (planned) a first-class MCP server so a customer's own agent can operate on
  tickets/KB under the same guardrails as Seredina's own AI — auditable and
  self-hostable, not a black-box SaaS feature.
- **NOC/SOC-integrated, not NOC/SOC-replacing**: a real first-class alert-ingestion
  channel (`POST /v1/alerts`, `docs/adr/0003-alert-ingestion.md`) turns existing
  monitoring/SIEM alerts into tickets, deliberately not competing with mature
  categories Seredina has no business rebuilding.
- **One codebase, two deployment modes**: self-hosted Docker (single tenant) and
  multi-tenant cloud, switched by `SEREDINA_MODE`, not a fork — so the choice
  between "run it yourself" and "let us run it" isn't a one-way door.

## What "winning" looks like (near-term, informal)

Not tracked as formal KPIs yet (no users). Directionally: a self-hoster picks
Seredina over GLPI/osTicket because the day-to-day agent experience feels
noticeably better, and does so without giving up ITAM breadth or an open license.
