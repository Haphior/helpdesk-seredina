# ADR 0060: Security audit log

## Status

Accepted, implemented. Resolves the "real security-event audit log" item
deferred in the security-hardening pass and required by Phase 5.

## Context

Nothing recorded who signed in, who failed to, or who gave someone admin
rights, rotated a webhook secret, connected a mailbox or exported every
ticket. Ticket history covers work on tickets. `AiAgentRun` covers the AI.
Nothing covered access and configuration, and that is the first thing a
security review, an incident investigation, or regulation asks for (Chile's
Ley 21.663 and Ley 21.719, ISO 27001 A.8.15, SOC 2 CC7.2).

## Decision

### What is recorded

Security-relevant events only, not every write:

- **Sign-ins**: success, failure (reason: `unknown_user`, `wrong_password`,
  `account_locked`, `account_inactive`), and the lockout itself.
- **Access**: users created, renamed, deactivated or reactivated, role
  changed, unlocked, password reset; roles created, changed or deleted.
- **Integrations and secrets**: API keys, webhooks (including secret
  rotation), email channels (including the OAuth connection), Telegram, AI
  provider settings and autonomy policy, knowledge base portal access.
- **Endpoint agents**: enrollment tokens minted, agents enrolled,
  re-enrolled or revoked.
- **Data leaving**: full tenant exports.

Each entry has the actor (user id plus the email at the time, so it stays
readable after the user is renamed or removed), action, target, IP (through
`TRUST_PROXY`), user agent, and small structured metadata.

**Secrets are never written**: an AI key change is `apiKeyChanged: true`,
and a portal access code is `changed` or `removed`. Tests check this.

### Append-only

`app_tenant`, the role the API and worker connect as, gets `SELECT, INSERT`
on `audit_logs` and nothing else (`prisma/rls/policies.sql`). Even a
compromised API process can't rewrite or erase history. The usual
tenant-isolation RLS policy applies on top.

### Never blocks the action

`recordAudit` runs in its own transaction after the action commits, and
logs and swallows its own failures. A failed audit write never fails a sign-in
or a settings change. An action that rolled back never leaves an entry
claiming it happened.

Sign-in writes happen after `login()`'s transaction commits, so they don't
disturb the lockout counter logic.

### Access

Viewing the log needs a new `audit:read` permission. The migration adds it
to every tenant's built-in `admin` role, so upgraded installs don't lose
access. Custom roles can be granted it on the Roles page. `GET /audit-logs`
filters by action (exact, or a prefix ending in `.`), actor and date, with
keyset pagination.

## Consequences

- There's no retention limit yet. The table grows with sign-ins. The
  `(tenant_id, created_at)` index keeps reads fast, and a retention job can
  be added when a tenant needs one.
- Actions taken through the MCP server or API keys (ticket creation) aren't
  in this log. They're ticket work, not access changes. The AI's actions are
  in `AiAgentRun`.
