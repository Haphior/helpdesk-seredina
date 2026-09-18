# ADR 0036: Phase 4 — self-hosted signup gating, bring-your-own AI key, custom roles

## Status

Accepted, implemented.

## Context

Phase 4's named items (docs/ROADMAP.md) are broad; this pass tackles the
three that needed no external account/credential/pricing decision from the
user: self-hosted single-tenant enforcement (a real gap found while
scoping, not originally called out this specifically), bring-your-own AI
key (a natural extension of Phase 3's multi-provider adapter work), and
custom roles (the schema was already generic; only CRUD was missing).
Deliberately **not** attempted here: "plan-tier scaffolding" (real pricing
tiers are the user's own business decision, not something to invent), and
the channel/integration items that need real external accounts (WhatsApp,
Slack, etc.).

An investigation pass before writing any code found the actual gaps
smaller/different than the roadmap's one-line description implied for two
of the three items — worth recording since it changed scope:

- Self-signup already worked *identically* in self-hosted and cloud mode —
  slug collision handling, rate limiting, and validation were all already
  correct. What was missing was `SEREDINA_MODE` never being consulted at
  all: a self-hosted deployment (architecturally single-tenant, per
  `docs/PRODUCT.md`) had no actual enforcement stopping a second, orphaned
  tenant from being created with no UI ever pointing at it.
- Custom roles' schema (`Role`/`Permission`/`RolePermission`) was already
  fully generic, and `login()` already derives a user's real permissions
  from these DB rows, never from the hardcoded `DEFAULT_ROLES` map (that map
  is only ever consulted once, at tenant registration, to seed the starting
  three). `roles:manage` was defined and assigned to `admin` from day one
  but checked by zero routes anywhere in the codebase. The only missing
  piece was CRUD — not a deeper structural gap.

## Decisions

### Self-hosted single-tenant enforcement

`registerTenant` now reads `SEREDINA_MODE` directly (the same pattern
`getAiAdapter`/`lib/queue.ts` already use for their own env vars) and, in
`self_hosted` mode, refuses a second registration once any tenant already
exists. "Does any tenant exist" has no tenant context to check from by
definition — the same situation `resolveTenantIdBySlug`/
`resolveTenantIdByApiKeyHash` were already in — so a new `count_tenants()`
SECURITY DEFINER function (`prisma/rls/policies.sql`) was added following
that exact established escape-hatch pattern: exposes a count, nothing about
any tenant's actual data. The new tenant's own `mode` column is now also set
from `SEREDINA_MODE` correctly (it was hardcoded to `'cloud'` regardless of
deployment before this).

### Bring-your-own AI key (`TenantAiSettings`)

One row per tenant (same "no row = default" shape as `BusinessHours`/
`AutonomyPolicy`): `provider`, `apiKeyEncrypted`, `model`, `baseUrl`, all
nullable per-field rather than one JSON blob — deliberately, so `'ollama'`
(needs no key) and "provider picked, key not saved yet" are both cleanly
representable. `apiKeyEncrypted` follows `EmailChannel`'s exact established
pattern: AES-256-GCM via `packages/shared/src/crypto.ts`'s
`encryptSecret`/`decryptSecret`, the same `ENCRYPTION_KEY`, the
`<thing>Encrypted` naming convention — a tenant's own AI key is exactly as
sensitive as their mailbox credentials, stored no differently.

`getAiAdapter(tenantId)` changed shape (was a sync, zero-argument
deployment-only lookup) to check the tenant's own settings **first, and
exclusively** — if a tenant configured a provider, the deployment-wide env
vars are never consulted at all, even as a fallback for a missing key. A
tenant that picked "openai" but hasn't pasted a key yet correctly sees "AI
not configured" (null), never silently falls back to spending the
*deployment's* Anthropic credit for a request they explicitly routed
elsewhere. Only a tenant with **no** `TenantAiSettings` row at all falls
through to the pre-existing deployment-wide `AI_PROVIDER` logic, unchanged.

The frontend (`AI Settings`, Operations group) never re-displays a saved
key — only whether one is set (`hasApiKey`), the same "shown once, never
again" posture this codebase already uses for webhook signing secrets and
API keys. A `DELETE /ai-settings` explicitly clears the row and reverts to
the deployment default, a deliberate separate action rather than inferring
"clear" from an empty PATCH field.

### Custom roles

`POST/PATCH/DELETE /roles` added alongside the pre-existing (read-only)
`GET /roles`, gated on `roles:manage` — the first real enforcement of that
permission anywhere in this codebase. `key` is immutable once created (same
convention as `CustomFieldDefinition`); permission updates are a full
delete-and-recreate of `RolePermission` rows (same pattern as
`ProcessTemplate`'s step list) rather than an add/remove diff, since those
rows carry no other state a rebuild would lose. Every permission key is
validated against the real `PERMISSIONS` catalog before touching the
database, on both create and update.

Deleting the seeded `admin` role is blocked outright — every tenant needs
at least one role that can manage users/roles, and it's the one
registration always seeds. Deleting a role with users still assigned is
blocked with a friendly, count-based message ("reassign them first") rather
than surfacing the raw FK constraint error Postgres would otherwise throw
(`User.roleId` has no `onDelete` action, so the database itself would
already refuse this — the pre-check exists purely for a clean error
message, same reasoning as `deleteTicketStatus`'s equivalent guard).

No frontend changes were needed for a custom role to actually work once
created: `Users.tsx` already fetched `GET /roles` dynamically and rendered
whatever came back, never a hardcoded three-item list — confirmed live,
not assumed (see Verified).

## Consequences

- **"Plan-tier scaffolding" is explicitly not built.** Adding a fake
  `planTier` enum with invented tier names/limits would be worse than not
  building it — real pricing is a business decision only the user can make.
  This stays open until that decision exists.
- **`getAiAdapter`'s signature change is a real breaking change within this
  codebase** (sync → async, zero-arg → `tenantId`) — all three call sites
  (`suggest-reply`, `summarize`, `autonomous-run`) and the existing
  `ai-adapter-selection.test.ts` suite were updated; that test suite also
  gained a `DATABASE_URL` dependency it didn't have before, since the
  tenant-settings lookup needs a live Postgres connection even to return
  "no row, use the fallback."
- **A tenant's `TenantAiSettings.model` field has no validation against the
  provider's actual available models** — a typo'd model name fails at the
  provider's own API call time (a normal `LlmProviderAdapter.complete()`
  error), not at settings-save time. Acceptable: validating this properly
  would mean each adapter exposing its own live model list, a bigger
  feature than this pass's scope.
- **No UI warns an admin before they strip `roles:manage`/`users:manage`
  from their own role's permission set**, which could lock every admin out
  of managing roles/users for that tenant (though never out of the
  application itself — `tickets:*` etc. are unaffected, and this is a
  service-layer capability, not an account lockout). A future iteration
  could add a "you're about to remove your own access to this page" guard;
  not built here to keep this pass's scope to CRUD + the one hardcoded
  `admin`-role delete protection.

## Verified

**`apps/api/test/auth-self-hosted.test.ts`, 2 tests, live Postgres**: cloud
mode (default) allows unlimited tenants, each correctly tagged
`mode: "cloud"`; self-hosted mode refuses a second tenant once one already
exists. (The "very first registration on a truly empty self-hosted
instance" branch isn't independently testable against this shared dev/test
database, which always already has other tenants from every other
integration test's own fixture setup — disclosed directly in the test
file's own comment rather than glossed over; that branch is a single `> 0`
check falling through to the same code path the cloud-mode test already
exercises, not a separately risky path.)

**`apps/api/test/ai-byok.test.ts`, 7 tests, live Postgres**: a fresh
tenant's settings are empty and never expose a key; saving a provider+key
never returns the key itself, only `hasApiKey`; the key **round-trips
through real AES-256-GCM encryption** (set via the service function, read
back via the internal resolver, confirmed to be the exact original
plaintext — not just a boolean flag flipping); an invalid provider name is
rejected; `getAiAdapter` prefers tenant settings over the deployment-wide
env vars entirely, even when both are present; a tenant provider configured
with no key yet returns null rather than falling back to a deployment key
that exists; clearing tenant settings correctly reverts to the
deployment-wide config.

**`apps/api/test/custom-roles.test.ts`, 7 tests, live Postgres**: create +
list a role with an arbitrary permission set; reject an unknown permission
key; reject a duplicate role key; `updateRole` fully replaces the
permission set and can rename; deleting `admin` is blocked; deleting a role
with an assigned user is blocked and succeeds once reassigned; and —
the test that actually proves the end-to-end claim, not just the CRUD —
**a custom role with only `tickets:read` produces exactly that permission
set from a real `login()` call**, confirming custom roles take effect for
real authorization, not just in a management UI.

Full `apps/api` suite: 206/206 passing (9 skipped, unrelated) after all
three features. Both `apps/api`/`apps/web` typecheck clean.

**Frontend verified live in a browser** (Playwright, real dev stack, no
mocks): registered a tenant; on AI Settings, selected OpenAI, saved a fake
key, confirmed the save succeeded, confirmed the provider choice survives a
full page reload, confirmed the "currently set" hint appears instead of the
key, and confirmed the raw key string never appears anywhere in the
rendered page at any point. On Roles, confirmed the seeded `admin` role
lists correctly, created a new "Billing Viewer" role with a single
permission through the real UI, confirmed it appears in the roles list
immediately — and, critically, navigated to the Users page and confirmed
the brand-new role **already appears in its role-assignment dropdown**,
proving the full loop (create a role → it's immediately usable when
assigning a user) works live, not just at the API layer. Zero browser
console errors throughout.
