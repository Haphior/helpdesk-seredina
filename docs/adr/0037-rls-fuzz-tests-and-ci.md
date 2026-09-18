# ADR 0037: First CI pipeline + automated RLS fuzz tests

## Status

Accepted, implemented.

## Context

The last remaining Phase 4 item within reach without an external
account/pricing decision: "automated RLS fuzz tests in CI." This repo had
**no CI at all** before this pass — no `.github/workflows`, no other CI
config anywhere — so this is genuinely the first pipeline, not an addition
to an existing one.

## Decisions

### CI mirrors the real deploy bootstrap, not a reinvention of it

`.github/workflows/ci.yml` runs `infra/docker/migrate-entrypoint.sh`
directly — the exact script `Dockerfile.migrate` already runs in production
(`prisma migrate deploy` → create/alter the `app_tenant` role → apply
`prisma/rls/policies.sql` → seed the permission catalog) — against disposable
Postgres/Redis service containers, rather than reimplementing those steps
inline in YAML. Every credential in the workflow is a fixed, throwaway value
scoped to that job's own disposable database; none is a GitHub secret, since
there is nothing real to protect.

**Verified locally before ever pushing it**, not assumed to work from
reading the YAML: created a genuinely fresh, empty database in this
session's own dev Postgres, ran `migrate-entrypoint.sh`'s exact steps
against it (the `psql` calls via `docker exec`, since this sandbox's host
has no `psql` binary — a local sandbox limitation, not a CI one; the actual
GitHub runner installs it explicitly), then ran the *entire* `apps/api`
test suite against that freshly-bootstrapped database. This is something
this session had never actually verified before: every previous migration
this session wrote was applied incrementally onto an already-migrated dev
database, never proving all 30 migrations (including the three hand-crafted
ones for pgvector/autonomy/BYOK, each with a deliberately-omitted
`DROP INDEX` — see ADR 0032/0033/0036) apply cleanly in order from
genuinely nothing. They do — 207/207 tests passed against the fresh
database, identical to the incrementally-migrated one.

### Fuzz test scope: breadth over re-deriving the RLS proof

The existing hand-written isolation suites (`tenant-isolation.test.ts`,
`asset-tenant-isolation.test.ts`, `ticket-tenant-isolation.test.ts`) already
prove RLS itself — not just the Prisma Client Extension — blocks a
cross-tenant leak, including a positive control proving the leak is real
with both defense layers disabled. That's a structural guarantee already
proven to apply uniformly to every table, since every tenant-scoped table
gets the *identical* policy shape from the same `FOREACH` loop in
`policies.sql`. Re-deriving that proof per table would be redundant, not
more rigorous.

What a fuzz test genuinely adds is **breadth of table coverage** against a
different, real risk: a newly added tenant-scoped table wired into
`TENANT_SCOPE_FIELD` (`packages/db/src/prisma.ts`) and/or
`policies.sql`'s GRANT/`FOREACH` lists *incorrectly*, or forgotten from one
of them — exactly the kind of three-file-must-move-together bookkeeping
this session has manually repeated (and could just as easily have gotten
wrong) every time a new table was added across ADRs 0032/0033/0036.

`apps/api/test/rls-fuzz.test.ts` uses `fast-check` to randomly exercise
**18 tenant-scoped models** — every one simple enough to construct a
minimal valid row for with no required dependency beyond `tenantId` itself.
Each of 40 random runs: picks one of the 18 models, mints a fresh pair of
tenants, creates a row under tenant A, confirms it reads back for tenant A
(a sanity check — a failure here means the test's own fixture is broken,
not that isolation failed, and is reported with a distinct error message so
the two failure modes are never confused), then asserts tenant B's own
`withTenantTx` context reads back `null` for that same row's id.

**Deliberately excluded**: every model needing a required FK beyond
`tenantId` (`User`, `Ticket`, `Message`, `Attachment`, `ProcessInstance`,
`EscalationTier`/`Run`, `DashboardWidget`, `SavedView`,
`NotificationPreference`, `ServiceAsset`, `TicketAsset`, `DiscoveryJob`,
`EmailChannel`, `AssetModel`, `ProcessStepTemplate`/`Instance`,
`AiAgentRun`, `AiUsageLog`, `KbChunk`). Building a fully generic
valid-fixture factory that could construct a correct instance of *any*
schema shape — resolving arbitrary FK chains automatically — was judged not
worth the engineering cost against the real value of covering the 18 simple
models for real; `Ticket`'s own isolation already has dedicated hand-written
coverage.

### Why not re-prove RLS itself is what's blocking the fuzz test's reads

Considered adding a "positive control" to the fuzz suite itself (temporarily
disabling RLS to confirm the fuzz test's own assertions would catch a real
leak, mirroring `tenant-isolation.test.ts`'s own positive control) and
decided against it: doing that safely for 18 tables would mean repeatedly
toggling `FORCE ROW LEVEL SECURITY` on shared tables in this session's
persistent dev database, a real risk for a check that's already established
generically by the 3 existing hand-written suites. The fuzz test's own job
— confirmed by it passing cleanly on the very first run across all 18
models, with each model's `create` call succeeding and each cross-tenant
read correctly returning `null` — is fixture-correctness-checked breadth,
not a second derivation of the underlying mechanism's soundness.

## Consequences

- **The local embedding model download is cached in CI** (`actions/cache`,
  keyed on the model name) specifically because `packages/ai-adapters`'
  test suite downloads a real ~90MB ONNX file from HuggingFace on first use
  (see ADR 0032) — without caching, every CI run would re-download it.
- **Fuzz coverage is 18 of roughly 36 tenant-scoped tables.** A future
  iteration could grow this by building fixtures for the FK-dependent
  models too, but that's a genuinely bigger undertaking (essentially a full
  test-data-factory system) than this pass's scope.
- **CI has no branch protection configured** (this ADR only adds the
  workflow itself) — requiring it to pass before merging to `main` is a
  repository-settings decision, not a code change, and is left to the user.

## Verified

**Locally, before pushing**: the exact `migrate-entrypoint.sh` bootstrap
sequence run against a genuinely fresh, empty database (not this session's
long-lived, incrementally-migrated dev database) — all 30 migrations
applied cleanly and in order via a single `prisma migrate deploy`, RLS
policies applied with the expected `NOTICE: policy ... does not exist,
skipping` output (correct for a truly fresh install, where the
`DROP POLICY IF EXISTS` lines have nothing to drop yet), the permission
catalog seeded, and the **full `apps/api` test suite — 207/207 — passing
against that fresh database**, identical to the result against the
long-lived one. The workflow YAML itself was validated as parseable.

**`apps/api/test/rls-fuzz.test.ts`**: 40 randomized runs across 18 models,
all passing — every model's fixture reads back correctly for its owning
tenant, and every cross-tenant read correctly returns `null`. Full
`apps/api` suite re-run after adding it: 207/207 green (9 skipped,
unrelated), confirming no interference with the existing suites. Both
`apps/api`/`apps/web`/`apps/worker`/`apps/mcp-server` typecheck clean.

**Known gap, not silently skipped**: the actual GitHub Actions run of this
workflow could not be observed from within this sandbox (no `act` tool
available to run it locally, and this session has no way to trigger and
watch a real Actions run before pushing) — every individual step was
verified by running its real underlying command locally against equivalent
infrastructure instead, which is strong but not identical evidence to a
real Actions run succeeding end-to-end on the actual runner image.
