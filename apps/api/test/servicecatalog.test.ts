import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { createCustomFieldDefinition } from '../src/modules/customfields/service';
import { createServiceCatalogItem, createTicketFromCatalogItem, deleteServiceCatalogItem, listServiceCatalogItems } from '../src/modules/servicecatalog/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Service Catalog', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `cat-${tenantId.slice(0, 8)}`, name: 'Catalog Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
    await createCustomFieldDefinition(tenantId, { key: 'laptop_model', label: 'Laptop model', fieldType: 'TEXT' });
  });

  it('creates an item and rejects a duplicate name', async () => {
    const item = await createServiceCatalogItem(tenantId, {
      name: 'New laptop',
      description: 'Request a new laptop for a new hire.',
      icon: '💻',
      customFieldKeys: ['laptop_model'],
    });
    expect(item.customFieldKeys).toEqual(['laptop_model']);
    expect(item.sortOrder).toBe(0);

    await expect(createServiceCatalogItem(tenantId, { name: 'New laptop' })).rejects.toThrow(
      'a service catalog item with this name already exists',
    );
  });

  it('assigns increasing sortOrder to successive items', async () => {
    const second = await createServiceCatalogItem(tenantId, { name: 'VPN access' });
    expect(second.sortOrder).toBe(1);
  });

  it('creates a ticket pre-filled from the item, on the catalog channel, with the requester as the contact', async () => {
    const item = await createServiceCatalogItem(tenantId, {
      name: 'Onboard a contractor',
      description: 'Sets up accounts and equipment for a new contractor.',
      customFieldKeys: ['laptop_model'],
    });

    const ticket = await createTicketFromCatalogItem(tenantId, item.id, {
      contactEmail: 'manager@example.com',
      contactName: 'Hiring Manager',
      customFields: { laptop_model: 'MacBook Pro 14"' },
    });

    expect(ticket.subject).toBe('Onboard a contractor');
    expect(ticket.channel).toBe('catalog');
    expect((ticket.customFields as Record<string, unknown>).laptop_model).toBe('MacBook Pro 14"');

    const withContact = await withTenantTx(prisma, tenantId, (tx) =>
      tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { contact: true } }),
    );
    expect(withContact.contact.email).toBe('manager@example.com');
  });

  it('an explicit subject overrides the item name; an empty one falls back to it', async () => {
    const item = await createServiceCatalogItem(tenantId, { name: 'Software license request' });

    const withSubject = await createTicketFromCatalogItem(tenantId, item.id, {
      contactEmail: 'a@example.com',
      contactName: 'A',
      subject: 'Figma seat for design team',
    });
    expect(withSubject.subject).toBe('Figma seat for design team');

    const withoutSubject = await createTicketFromCatalogItem(tenantId, item.id, {
      contactEmail: 'b@example.com',
      contactName: 'B',
      subject: '   ',
    });
    expect(withoutSubject.subject).toBe('Software license request');
  });

  it('rejects requesting a nonexistent item', async () => {
    await expect(
      createTicketFromCatalogItem(tenantId, '00000000-0000-0000-0000-000000000000', {
        contactEmail: 'a@example.com',
        contactName: 'A',
      }),
    ).rejects.toThrow('service catalog item not found');
  });

  it('deletes an item and rejects deleting one that does not exist', async () => {
    const item = await createServiceCatalogItem(tenantId, { name: 'Temporary item' });
    await deleteServiceCatalogItem(tenantId, item.id);

    const items = await listServiceCatalogItems(tenantId);
    expect(items.find((i) => i.id === item.id)).toBeUndefined();

    await expect(deleteServiceCatalogItem(tenantId, item.id)).rejects.toThrow('service catalog item not found');
  });
});
