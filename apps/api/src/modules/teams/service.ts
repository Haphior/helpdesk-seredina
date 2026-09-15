import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { withTenantTx } from '../../lib/tenant-context';

export const DEFAULT_TEAM_NAME = 'General';

/** Called from auth/service.ts's registerTenant, inside its own tenant transaction -- not a standalone entry point. */
export async function seedDefaultTeam(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.team.create({ data: { tenantId, name: DEFAULT_TEAM_NAME } });
}

export async function listTeams(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => tx.team.findMany({ orderBy: { name: 'asc' } }));
}
