# Changelog

All notable changes to Seredina are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) (pre-1.0, so any release may still
contain breaking changes).

## [Unreleased]

## [0.1.0-alpha.1] - 2026-09-22

First public alpha. All of Phases 0-5 from `docs/ROADMAP.md` are in, plus a
first pass of console internationalization. This is a feature-complete-for-v1
snapshot, not a "just started" alpha — but it hasn't yet been run in
production by anyone outside this project, hence alpha.

### Added

- **Core ticketing**: multi-tenant ticket queue with email/API/webhook/widget
  ingestion, threaded replies, internal notes, merges, macros, saved views,
  bulk actions, and custom fields.
- **ITSM/ITAM breadth (GLPI-scope)**: SLA policies with business hours,
  service catalog, change/problem/release management with process templates,
  agentless network discovery (TCP+SNMP) into a CMDB, and a real endpoint
  agent (`apps/agent`) for hardware/software inventory on Windows/Linux/macOS
  (inventory-only by design — see `docs/adr/0002-agentless-discovery.md`).
- **AI copilot**: pluggable provider adapters (Anthropic, OpenAI, local
  Ollama — bring your own key), suggest-reply/summarize on tickets, a full
  autonomous tool-use loop gated by a per-tenant Autonomy Policy, RAG over the
  knowledge base, and an MCP server (stdio + Streamable HTTP) so external
  agents can operate under the same guardrails.
- **Multi-tenant cloud hardening**: Postgres Row-Level Security as the primary
  tenant-isolation layer plus an independent Prisma-level layer, account
  lockout, and a mandatory cross-tenant-leak test suite.
- **Integrations**: inbound/outbound email, Slack and Microsoft Teams
  (bring-your-own webhook), Telegram, Zabbix alert ingestion, and CSAT survey
  delivery.
- **Console internationalization v1**: English and Spanish, per-user
  language preference.
- **Guided product tour** and a **customizable dashboard** (per-widget
  show/hide/resize/reorder via drag-and-drop, plus an "Add widget" catalog).
- **Documentation site** (`apps/docs`, VitePress): user guide, deployment/
  hosting reference, and API/webhooks/MCP-server reference, in English and
  Spanish, published to GitHub Pages.

### Fixed

- All 4 open Dependabot alerts (a stale nested Vite copy pulled in by
  VitePress, deduped via a root `overrides` entry) and the 2 real CodeQL
  findings (missing workflow `permissions:`); 2 further CodeQL findings
  reviewed and dismissed as false positives with documented reasoning.
- Route-level code-splitting and a Postgres index (`Ticket`'s
  `[tenantId, createdAt]`) after a real Lighthouse-against-production-build
  performance pass.

[Unreleased]: https://github.com/Haphior/helpdesk-seredina/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/Haphior/helpdesk-seredina/releases/tag/v0.1.0-alpha.1
