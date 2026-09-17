import { prisma, withTenantTx, type Prisma } from '@seredina/db';

export interface SavedViewFilters {
  statusCategory?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  assigneeId?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

/** Always scoped to the caller's own userId -- a saved view is a personal convenience, never shared or tenant-wide (see docs/adr/0021-saved-views.md). */
export async function listSavedViews(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.savedView.findMany({ where: { userId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  );
}

export interface CreateSavedViewInput {
  name: string;
  filters: SavedViewFilters;
}

export async function createSavedView(tenantId: string, userId: string, input: CreateSavedViewInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.savedView.findUnique({ where: { userId_name: { userId, name: input.name } } });
    if (existing) throw new Error('a saved view with this name already exists');

    const count = await tx.savedView.count({ where: { userId } });
    return tx.savedView.create({
      data: { tenantId, userId, name: input.name, filters: input.filters as Prisma.InputJsonValue, sortOrder: count },
    });
  });
}

export async function deleteSavedView(tenantId: string, userId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.savedView.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new Error('saved view not found');
    await tx.savedView.delete({ where: { id } });
  });
}
