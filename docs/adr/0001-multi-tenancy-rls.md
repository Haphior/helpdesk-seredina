# ADR 0001: Multi-tenancy via `tenant_id` + Postgres RLS, with Prisma

## Status

Accepted, implemented in Phase 0.

## Context

Seredina must serve many organizations from one shared-schema cloud deployment, and
run self-hosted as a single-tenant deployment of the exact same code — not a fork.
That means tenant isolation has to be structural, not "every query happens to
remember its WHERE clause."

Prisma has no first-class Row-Level Security support, and there are two well-known
ways to get RLS+Prisma wrong:
1. `SET LOCAL app.tenant_id = ...` outside an explicit transaction evaporates before
   the next query runs (each statement is its own implicit transaction).
2. A bare, non-local `SET app.tenant_id = ...` on a pooled connection leaks into
   whatever other request grabs that connection next — a direct cross-tenant leak.

## Decision

- Every tenant-scoped request/job runs inside an explicit Prisma **interactive
  transaction** (`withTenantTx()`, `apps/api/src/lib/tenant-context.ts`), whose first
  statement is a parameterized `SELECT set_config('app.tenant_id', $1, true)`.
  Interactive transactions hold one physical connection exclusively for their
  duration, so the session variable cannot leak via pool reuse — both classic
  mistakes above are structurally avoided by construction, not by care.
- Two Postgres roles: `app_migrator` (table owner, used only by the one-shot
  `migrate` service) and `app_tenant` (non-owner, used by `api`/`worker` at runtime).
  Table owners bypass RLS by default in Postgres — this is the detail most guides
  miss — so the running application must never connect as the owner.
- `FORCE ROW LEVEL SECURITY` on every tenant-owned table, not just `ENABLE` — without
  `FORCE`, table owners (and only owners) bypass RLS anyway, but some Postgres
  tooling/roles can still slip past `ENABLE`-only policies; `FORCE` closes that.
- Policies key off `current_setting('app.tenant_id', true)` — the `true` (missing_ok)
  means an unset tenant context returns `NULL`, and `NULL` never equals a `uuid`, so a
  code path that forgets to open a tenant transaction fails **closed** (zero rows /
  rejected write), never open.
- A Prisma **Client Extension** (`apps/api/src/lib/prisma.ts`, not the deprecated
  `$use` middleware) is an independent second layer: it reads the tenant id from
  `AsyncLocalStorage`, injects/overrides the scope column on every write, and
  AND-wraps it into every read/update/delete `where`. It throws if no tenant context
  is bound, rather than running unscoped.
- Because the extension is applied via `$extends()` on the client passed into
  `withTenantTx`, and `$extends()` propagates into the client returned by
  `$transaction()`, the `tx` used inside every tenant transaction is *also* guarded —
  both layers are always active together in normal application code.
- A cross-tenant leak now requires both layers to fail at the same moment. Verified in
  `apps/api/test/tenant-isolation.test.ts`, which disables each layer independently
  (RLS via `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`, the extension via the
  separately-exported unguarded `uncheckedPrisma` client) to prove neither one is a
  silently-redundant no-op, plus a positive control proving the leak is real with both
  off.
- Self-hosted single-tenant mode is not a fork: it's the same schema and code path
  with exactly one `Tenant` row.

## One deliberate, narrow exception

Resolving "which tenant does this slug belong to" (login, registration's
slug-availability check) has no tenant context yet — it's the discovery step that
produces one. It cannot go through the RLS-gated table directly. Solved with a
Postgres `SECURITY DEFINER` function (`resolve_tenant_id(slug)`,
`apps/api/prisma/rls/policies.sql`) that runs with the table owner's privileges
regardless of the caller's session variable, but exposes exactly one column (`id`)
for exactly one input (`slug`) — a narrow, standard, auditable hole through RLS, not a
general bypass.

## Consequences

- Never call slow external I/O (LLM completions, SMTP sends) inside `withTenantTx` —
  it would hold a pooled connection open for the duration and starve the pool under
  load. Pattern: short tx to read → external call with no transaction open → short tx
  to write.
- Every new tenant-scoped model added in later phases needs both an RLS policy in
  `prisma/rls/policies.sql` and an entry in `TENANT_SCOPE_FIELD`
  (`apps/api/src/lib/prisma.ts`) — there is no single place that makes this automatic,
  so it must stay a checklist item in review, not something assumed to "just work."
- If a transaction-pooling PgBouncer is later placed in front of Postgres for cloud
  scaling, `set_config(..., true)` still works correctly (it's transaction-scoped),
  but Prisma needs `?pgbouncer=true` on its connection string to disable
  prepared-statement caching, which is incompatible with transaction-mode pooling.
