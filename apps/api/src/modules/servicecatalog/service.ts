import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi } from '../tickets/service';

export interface CreateServiceCatalogItemInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  customFieldKeys?: string[];
}

export async function listServiceCatalogItems(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.serviceCatalogItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  );
}

export async function createServiceCatalogItem(tenantId: string, input: CreateServiceCatalogItemInput) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.serviceCatalogItem.findUnique({ where: { tenantId_name: { tenantId, name: input.name } } });
    if (existing) throw new Error('a service catalog item with this name already exists');

    const count = await tx.serviceCatalogItem.count();
    return tx.serviceCatalogItem.create({
      data: {
        tenantId,
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        customFieldKeys: input.customFieldKeys ?? [],
        sortOrder: count,
      },
    });
  });
}

export async function deleteServiceCatalogItem(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.serviceCatalogItem.findUnique({ where: { id } });
    if (!existing) throw new Error('service catalog item not found');
    await tx.serviceCatalogItem.delete({ where: { id } });
  });
}

export interface RequestFromCatalogInput {
  contactEmail: string;
  contactName: string;
  subject?: string;
  customFields?: Record<string, unknown>;
}

/**
 * Creates a Ticket pre-filled from the chosen catalog item, via the exact
 * same creation path every other channel (api/alert) already uses --
 * createTicketFromApi -- rather than a second ticket-creation implementation.
 * See docs/adr/0016-service-catalog.md.
 */
export async function createTicketFromCatalogItem(tenantId: string, itemId: string, input: RequestFromCatalogInput) {
  const item = await withTenantTx(prisma, tenantId, (tx) => tx.serviceCatalogItem.findUnique({ where: { id: itemId } }));
  if (!item) throw new Error('service catalog item not found');

  return createTicketFromApi(tenantId, {
    subject: input.subject?.trim() || item.name,
    body: item.description ? `Requested: ${item.name}\n\n${item.description}` : `Requested: ${item.name}`,
    contactEmail: input.contactEmail,
    contactName: input.contactName,
    channel: 'catalog',
    customFields: input.customFields,
  });
}
