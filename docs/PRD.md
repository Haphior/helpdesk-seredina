# Seredina — Product Requirements Document

This consolidates `docs/PRODUCT.md` (ICP/pain/value), `docs/ROADMAP.md` (phased
scope), and the ADRs (architecture decisions) into a single document, for the
"create/export/load a PRD" checklist item. It is a **synthesis of decisions already
made**, not a new planning exercise — where the three source docs disagree with this
one, the source docs are more detailed and this PRD should be updated to match, not
the other way around. Re-derive this file after any major scope change rather than
hand-editing it out of sync.

## Problem

Teams needing IT service management today pick between two bad trade-offs:

- **Open-source ITSM (GLPI, osTicket)**: full feature breadth, real self-hosting,
  but a dated, utilitarian UX that agents and end users notice.
- **Commercial helpdesks (Zendesk, Freshdesk, Jira Service Management)**: polished
  UX, but closed, expensive at scale, weak on ITAM/CMDB, and treat AI as a paid,
  opaque add-on.

Separately, monitoring/SIEM tools (Zabbix, Wazuh, Grafana) generate alerts that need
to land as work items for a human — most ITSM tools treat that as an afterthought
integration rather than a first-class channel.

Full detail: [docs/PRODUCT.md](PRODUCT.md#pain).

## ICP

Primary: IT teams (internal, 20-500 person orgs, or MSPs) outgrowing GLPI/osTicket
or a lightweight helpdesk, for whom Zendesk-class tools are too expensive or too
narrow (support-ticket-only, no ITAM). Secondary: technical teams who want a
genuinely open-source (AGPL) self-hostable helpdesk that can later become a hosted
product without a rewrite. Full detail: [docs/PRODUCT.md](PRODUCT.md#icp-ideal-customer-profile).

Explicitly not the driver: Infraplast's own internal IT (see
[docs/PRODUCT.md](PRODUCT.md#icp-ideal-customer-profile) for why that's called out).

## Solution & value proposition

One AGPL-3.0 codebase, two deployment modes (self-hosted Docker / multi-tenant
cloud, switched by `SEREDINA_MODE`, not a fork), that is simultaneously:

1. A helpdesk with a modern UX (see [docs/DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)).
2. GLPI-scope ITSM/ITAM (ticketing, CMDB, agentless inventory).
3. AI-native: pluggable LLM provider adapters, copilot mode now, autonomous mode +
   MCP server planned — auditable and self-hostable, not a SaaS black box.
4. NOC/SOC-*integrated*, not NOC/SOC-*replacing*: `POST /v1/alerts` turns existing
   monitoring/SIEM output into tickets rather than competing with those categories.

Full detail: [docs/PRODUCT.md](PRODUCT.md#value-proposition).

## Scope by phase

Full detail, verification notes, and what shipped vs. was deferred within each
phase: [docs/ROADMAP.md](ROADMAP.md). Summary:

| Phase | Scope | Status |
|---|---|---|
| 0 — Foundations | Multi-tenant RLS + Prisma isolation, JWT auth, Docker Compose | ✅ Done |
| 1 — MVP | Ticketing core, API + email channels, agent console UI, CMDB + agentless discovery, multi-user tenants, UI visual refresh, AI copilot v1 | ✅ Done |
| 2 — Configurability & SLA | Alert ingestion (NOC/SOC) ✅, custom fields ✅, hardware/equipment catalog ✅, IT processes/procedures ✅, outbound webhooks ✅, macros ✅, SLA engine ✅, reporting v1 + dashboard ✅, Change Enablement ✅, Release Management ✅, Problem Management ✅, Service Catalog ✅, Service Configuration Management ✅, self-service portal + knowledge base ✅ (pulled forward from Phase 3), collision detection + ticket merge + bulk actions ✅, on-call scheduling + SLA escalation chains ✅, saved views per agent ✅, notification preferences per agent ✅ — every named Phase 2 item complete; only the three differentiators and onboarding items remain (see ROADMAP.md for the full expanded list; integrations, not a plugin platform, is the decided extensibility path) | 🚧 In progress |
| 3 — AI depth | RAG (pgvector), shared AI tool catalog, autonomous mode + `AutonomyPolicy`, MCP server, second LLM provider | Not started |
| 4 — Cloud hardening | Tenant self-signup, BYO AI key, widget/WhatsApp channels, custom roles, RLS fuzz tests in CI, multi-replica load verification | Not started |
| 5 — Endpoint agents | Windows/Linux/macOS inventory + opt-in remote execution/deployment agent, capability-tiered like Phase 3's `AutonomyPolicy`, desktop-only (not mobile MDM) | Not started |

## Explicitly out of scope (for now)

Carried from [ROADMAP.md § Backlog](ROADMAP.md#backlog-explicitly-deferred-not-forgotten):
Data Center Management, Environmental Impact Management, mobile MDM/MAM (Phase 5
covers the desktop half only — real Android Enterprise/Apple MDM enrollment is a
separate, much larger subsystem), mobile apps, voice/telephony, BPMN-style workflow
automation engine, SSO/SAML, data residency, console i18n. Also: **NOC/SOC will
never be natively built** (monitoring/SIEM are mature categories on their own —
Seredina integrates via webhook, permanently, not as a temporary scope cut), and
**no native code-loading plugin system** (a contract-based model — webhooks, API
keys, the planned MCP server — is the deliberate alternative, since loaded code
running inside the shared multi-tenant process would be a direct route around RLS
tenant isolation; see ROADMAP.md's Phase 2 for the full reasoning).

## Architecture references

Load-bearing decisions, not repeated here — read the ADR when touching the area:

- [ADR 0001](adr/0001-multi-tenancy-rls.md) — multi-tenancy via Postgres RLS + Prisma extension
- [ADR 0002](adr/0002-agentless-discovery.md) — agentless network discovery design
- [ADR 0003](adr/0003-alert-ingestion.md) — why alerts become `Ticket`s, not a new `Incident` model
- [ADR 0004](adr/0004-email-channel.md) — email channel (IMAP poll, SMTP send, threading)

## Key risks

Carried from [ROADMAP.md § Key risks](ROADMAP.md#key-risks-carried-forward-from-planning-revisit-each-phase) —
re-read that section (not duplicated here since it must stay current per-phase):
RLS+Prisma pooling correctness, never blocking a tenant transaction on slow I/O,
AGPL dependency/CLA hygiene, autonomous AI must ship opt-in/capped/audited,
agentless discovery is meaningless in shared cloud mode without a guard,
`ENCRYPTION_KEY` loss/rotation risk, and email-poll double-processing under
multiple worker replicas.

## Success (informal, no users yet)

No KPIs are tracked yet — there are no real users. Directionally: a self-hoster
picks Seredina over GLPI/osTicket because the agent experience is noticeably
better, without giving up ITAM breadth or an open license. Revisit this section
once Phase 1/2 are in front of real users.
