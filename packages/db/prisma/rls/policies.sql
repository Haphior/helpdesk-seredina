-- Run once, after `prisma migrate deploy`, by the one-shot `migrate` service — never
-- by the running api/worker processes. Idempotent: safe to re-run on every deploy.
--
-- Two roles, on purpose (see docs/adr/0001-multi-tenancy-rls.md):
--   app_migrator — owns every table (whoever CREATEs a table owns it; Prisma migrate
--                  connects as this role). Postgres table owners BYPASS RLS by
--                  default, which is exactly why the running API must never connect
--                  as this role.
--   app_tenant   — non-owner, used by apps/api and apps/worker at runtime. RLS only
--                  applies to non-owners, and FORCE ROW LEVEL SECURITY (below) closes
--                  the one remaining gap: a superuser/owner override.
--
-- The app_tenant role itself is created/password-set by migrate-entrypoint.sh
-- (via a plain shell heredoc, substituting APP_TENANT_DB_PASSWORD) BEFORE this file
-- runs -- not here. psql's `:'var'` interpolation does not reach inside a
-- dollar-quoted (`DO $$ ... $$`) body, so doing the idempotent create-or-alter
-- dance in SQL with a parameterized password does not work; plain shell substitution
-- has no such restriction, so that's where it belongs.

GRANT USAGE ON SCHEMA public TO app_tenant;

-- Global, non-tenant-owned catalog: runtime only ever reads it.
GRANT SELECT ON permissions TO app_tenant;

-- Tenant-owned tables: full CRUD for the app, but every row is gated by RLS below.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, roles, role_permissions, users,
  teams, contacts, ticket_statuses, tickets, messages, api_keys,
  assets, ticket_assets, discovery_jobs, email_channels, custom_field_definitions,
  manufacturers, asset_models, process_templates, process_step_templates,
  process_instances, process_step_instances, webhooks, macros
  TO app_tenant;

-- tenants: a tenant-scoped session may see only its own row (defense against
-- cross-tenant enumeration via the tenant registry itself). Its scope column is its
-- own `id`, everything else below is scoped by `tenant_id`.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- Every other tenant-owned table shares the exact same tenant_id-based policy shape
-- (see src/prisma.ts's TENANT_SCOPE_FIELD, which mirrors this table list) -- looped
-- instead of repeated by hand so adding a table here can't accidentally drift from
-- the shape above.
DO $do$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'roles', 'role_permissions', 'users',
    'teams', 'contacts', 'ticket_statuses', 'tickets', 'messages', 'api_keys',
    'assets', 'ticket_assets', 'discovery_jobs', 'email_channels',
    'custom_field_definitions', 'manufacturers', 'asset_models',
    'process_templates', 'process_step_templates', 'process_instances',
    'process_step_instances', 'webhooks', 'macros'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      tbl
    );
  END LOOP;
END
$do$;

-- current_setting(..., true) (missing_ok=true) returns NULL when unset rather than
-- erroring, and NULL never equals a uuid — so a code path that forgets to open a
-- tenant transaction fails CLOSED (zero rows / rejected write), never open.

-- Deliberate, narrow exception: resolving "which tenant does this slug belong to"
-- (login, registration's slug-availability check) has no tenant context yet — it's
-- the discovery step that produces one, so it can't go through the RLS-gated table
-- directly. SECURITY DEFINER runs this function's body with the OWNER's (app_migrator)
-- privileges, bypassing the caller's RLS regardless of session variables — but it
-- exposes exactly one column (id) for exactly one input (slug), nothing else about
-- other tenants. This is the standard, safe Postgres pattern for a single controlled
-- hole through RLS, not a general bypass.
CREATE OR REPLACE FUNCTION public.resolve_tenant_id(p_slug text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM tenants WHERE slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.resolve_tenant_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_id(text) TO app_tenant;

-- Same pattern, for the API channel (POST /v1/tickets): resolving "which tenant does
-- this API key belong to" from its hash has no tenant context yet either. See
-- schema.prisma's ApiKey model for why hashedKey is a plain SHA-256 digest (exact-
-- match lookup), not a bcrypt hash.
CREATE OR REPLACE FUNCTION public.resolve_tenant_id_by_api_key_hash(p_hashed_key text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM api_keys WHERE hashed_key = p_hashed_key;
$$;

REVOKE ALL ON FUNCTION public.resolve_tenant_id_by_api_key_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_id_by_api_key_hash(text) TO app_tenant;

-- Same escape-hatch pattern, inverted: apps/worker polls IMAP for every tenant's
-- active email channel(s), so unlike the two functions above it genuinely needs to
-- discover WHICH tenants to look at, not resolve a single already-known one. Exposes
-- only (id, tenant_id) -- never imap_password_encrypted or any other column -- the
-- worker fetches each channel's full row afterward through the normal tenant-scoped
-- path (withTenantTx), so credentials never pass through a SECURITY DEFINER context.
CREATE OR REPLACE FUNCTION public.list_active_email_channels()
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, tenant_id FROM email_channels WHERE is_active = true;
$$;

REVOKE ALL ON FUNCTION public.list_active_email_channels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_email_channels() TO app_tenant;
