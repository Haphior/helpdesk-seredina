import { prisma } from './prisma';

/**
 * Resolving "which tenant does this ApiKey belong to" has no tenant context yet
 * by definition -- it's the discovery step that PRODUCES one. Same pattern as
 * resolve_tenant_id_by_slug (apps/api/src/modules/tenants/service.ts): calls a
 * Postgres SECURITY DEFINER function (see prisma/rls/policies.sql) that exposes
 * exactly one column (tenant_id) for exactly one input (the key's hash),
 * executing with the table owner's privileges regardless of the caller's RLS
 * policy -- safe to run without a tenant context already bound.
 *
 * Lives in @seredina/db (not apps/api) so any consumer resolving a session's
 * tenant from an ApiKey -- apps/api's own auth plugin, and apps/mcp-server's
 * session bootstrap -- uses the identical implementation, never a second one.
 */
export async function resolveTenantIdByApiKeyHash(hashedKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`
    SELECT resolve_tenant_id_by_api_key_hash(${hashedKey}) AS id
  `;
  return rows[0]?.id ?? null;
}
