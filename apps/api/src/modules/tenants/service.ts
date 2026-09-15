import { prisma } from '@seredina/db';

/**
 * Resolving "which tenant does this slug belong to" has no tenant context yet by
 * definition -- it's the discovery step that PRODUCES one (used by login and by
 * registration's slug-availability check). Every other tenant-scoped query in this
 * codebase requires a tenant context (see packages/db/src/prisma.ts); this is the one deliberate,
 * narrow exception, and it does not go through the guarded Prisma client's model
 * layer at all -- it calls a Postgres SECURITY DEFINER function (see
 * prisma/rls/policies.sql) that exposes exactly one column (id) for exactly one input
 * (slug), executing with the table owner's privileges regardless of the caller's RLS
 * policy. That's what makes it safe to run without a tenant context already bound.
 */
export async function resolveTenantIdBySlug(slug: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`SELECT resolve_tenant_id(${slug}) AS id`;
  return rows[0]?.id ?? null;
}

/** Same pattern, for the API channel -- see modules/apikeys and prisma/rls/policies.sql. */
export async function resolveTenantIdByApiKeyHash(hashedKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string | null }[]>`
    SELECT resolve_tenant_id_by_api_key_hash(${hashedKey}) AS id
  `;
  return rows[0]?.id ?? null;
}
