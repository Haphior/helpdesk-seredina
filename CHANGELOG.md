# Changelog

All notable changes to Seredina are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/) (pre-1.0, so any release may still
contain breaking changes).

## [Unreleased]

### Added

- **Connect Microsoft 365 and Gmail mailboxes with OAuth**
  (`docs/adr/0055-email-oauth.md`): the Email Channels page now offers
  "Microsoft 365 / Outlook" and "Gmail / Google Workspace" next to plain
  IMAP/SMTP. You register your own app in Microsoft Entra or Google Cloud,
  paste its client ID and secret, and sign in as the mailbox; server
  settings are filled in for you. Tokens are refreshed automatically. If the
  provider revokes access, the channel shows "Reconnect needed" and stops
  being polled until you reconnect. Login errors for any mailbox, including
  password ones, now show on the Email Channels page.
- **Email attachments are kept** (`docs/adr/0056-inbound-email-attachments.md`):
  files attached to an incoming email (including pasted screenshots) are
  saved on the ticket, with the same 8 MB / 5-per-message limits as manual
  uploads. Anything that doesn't fit is named in a note on the message
  instead of disappearing.
- **Replies go out from the mailbox the customer wrote to**, when a tenant
  has more than one email channel, instead of always from the first one.
- **`worker` can run as several replicas**: each mailbox is polled under a
  per-mailbox lock and a repeated Message-ID is ignored, so emails no longer
  turn into duplicate tickets (`docs/adr/0057-email-poll-lock.md`).
- **Audit log** (`docs/adr/0058-audit-log.md`): Administration → Audit Log
  shows sign-ins (including failed ones and lockouts, with IP and browser),
  changes to users and roles, and changes to API keys, webhooks, email
  channels, Telegram, agents, AI settings and the knowledge base portal, plus
  full data exports. Entries can't be edited or deleted, even by the app
  itself. Needs the new `audit:read` permission, which existing admin roles
  get automatically.
- **Your own address, with HTTPS** (`docs/adr/0054-server-address-and-tls.md`):
  `scripts/configure-address.sh` asks for the server's domain or IP and how
  to get a certificate: Let's Encrypt (automatic), your own certificate or
  company CA, a generated internal CA (for an IP or internal network), or
  none. It then starts an optional HTTPS proxy (Caddy) in front of
  everything. The console and API now share one address, with the API under
  `/api`, so the web build no longer needs the API URL baked in.
- **Agents choose the server and trust your certificate**: the Devices page
  has a "Server address for agents" field. When the certificate isn't
  publicly trusted, the enrollment command carries the server's CA, and the
  agent trusts only that CA — certificate verification is never turned off.
  `--ca <file>` works too.

- **Live console updates** (`docs/adr/0053-live-updates.md`): the ticket
  queue, ticket detail and notification bell now update as things happen —
  a new ticket slides into the queue, a customer's reply or a colleague's
  note appears in the open ticket, the bell counts up — without reloading.
  The queue shows a Live / Reconnecting indicator. Built on a
  Server-Sent Events stream (`GET /events`) fed by Redis pub/sub, so it
  works across API replicas and for changes the worker makes (inbound
  email, SLA breaches, escalations). Events carry ids only; the console
  refetches through the normal API, so the stream can't expose anything
  the viewer couldn't already read.

- **Knowledge base portal access control**: the public self-service KB portal
  can now be disabled entirely (internal-only KB) or gated behind a single
  shared access code, from a new "Portal settings" panel on the console's
  Knowledge Base page. Previously any published article was reachable by
  anyone with the link, with no way to turn that off. See
  `docs/adr/0051-kb-portal-access-control.md`.
- **Create a ticket directly from a process step**, assigned to a user in
  the same action, plus drag-to-reorder and a duplicate-step button when
  configuring process templates. See
  `docs/adr/0052-process-ticket-creation-and-reorder.md`.
- `JWT_EXPIRES_IN` env var for the console session length (default `8h`).
- **Agent-based discovery** (`docs/adr/0052-agent-based-discovery.md`):
  - Reinstalling the agent on the same machine reuses its existing record
    (matched by a hashed OS machine id) instead of creating a duplicate; the
    old install's credential stops working.
  - **Passive network discovery**: each check-in reports the agent's ARP
    table, and the devices in it become assets (source `AGENT_NEIGHBOR`),
    identified by MAC — a DHCP lease change now moves the IP on the same
    record instead of creating a new one. Enrolling a machine that was already
    discovered this way adopts that record.

### Changed

- The console reaches the API at `/api` on its own address by default
  (`VITE_API_URL` now defaults to empty). Existing `.env` files that set it
  keep working.
- With the HTTPS proxy enabled, the web (8080) and API (4000) ports only
  listen on the server itself, so HTTPS is the only way in from the network.
  Agents enrolled at `http://<ip>:4000` need a new enrollment command, and
  keep their record when re-enrolled.
- The embeddable widget works when served under a path
  (`https://<address>/api/widget.js`).

- **Network scans from the server are self-hosted only.** In cloud mode the
  API refuses them (403), the worker won't run them, and the Assets page hides
  the form — the worker there sits on the provider's network, not the
  tenant's. `infra/docker-compose.yml` now passes `SEREDINA_MODE` to `worker`.
- `POST /v1/devices/checkin` returns `200 { neighbors: { created, updated } }`
  instead of `204`.

### Security

- **Postgres and Redis are no longer published on every network
  interface.** Redis has no password, so anyone who could reach the server
  could read and write its queues. Both now listen on `127.0.0.1` only
  (`DB_BIND`).
- The API honors `X-Forwarded-For` from the proxies in front of it
  (`TRUST_PROXY`), so per-IP rate limits see the real client instead of
  one shared proxy address.

- **Console sessions now expire and are revoked immediately.** Login tokens
  previously never expired, and their permissions were a snapshot from login
  time -- a deactivated or demoted user kept their old access indefinitely.
  Tokens now expire (`JWT_EXPIRES_IN`, default `8h`), tokens issued before
  this release are rejected (everyone signs in once more), and every request
  re-checks that the user is still active and uses their *current* role's
  permissions.
- **No privilege escalation through `users:manage`.** A user can no longer
  create a user with, or assign, a role that has permissions they don't have
  themselves (e.g. a custom role with `users:manage` promoting itself to
  `admin`).
- **Outbound SSRF hardening.** Webhook delivery no longer follows redirects
  (a public URL answering `307` to `169.254.169.254` bypassed the check),
  checks every address a hostname resolves to, and blocks IPv4 addresses
  hidden in IPv6 forms (`::ffff:127.0.0.1`, NAT64, 6to4) plus the remaining
  reserved ranges (CGNAT, multicast, ...). In cloud mode, a tenant's own
  Ollama `baseUrl` gets the same protection, both when saved and on every
  request.
- Login takes the same time whether or not the email exists, so response
  timing no longer reveals which accounts exist; the Telegram webhook secret
  is compared in constant time.

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
