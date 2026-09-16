import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';
import { createCustomFieldDefinition, listCustomFieldDefinitions } from '../src/modules/customfields/service';

/**
 * Not a tenant-isolation test (that mechanism is proven generically, see
 * test/tenant-isolation.test.ts) -- this is the one piece of actual custom-fields
 * logic worth an automated check: that a PATCH merges into the existing jsonb
 * instead of replacing it wholesale, which is easy to get wrong (naively spreading
 * only `input.customFields` into `data.customFields` would silently drop every
 * other field already stored the moment a second field gets edited).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('custom fields', () => {
  let tenantId: string;
  let ticketId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `cf-${tenantId.slice(0, 8)}`, name: 'Custom Fields Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Custom fields test ticket',
      body: 'body',
      contactEmail: 'cf-test@example.com',
      contactName: 'CF Test',
    });
    ticketId = ticket.id;
  });

  it('creates a definition with the correct defaults', async () => {
    await createCustomFieldDefinition(tenantId, { key: 'order_number', label: 'Order Number', fieldType: 'TEXT' });
    await createCustomFieldDefinition(tenantId, {
      key: 'shirt_size',
      label: 'Shirt Size',
      fieldType: 'SELECT',
      options: ['Small', 'Medium', 'Large'],
    });

    const defs = await listCustomFieldDefinitions(tenantId);
    expect(defs.map((d) => d.key).sort()).toEqual(['order_number', 'shirt_size']);
    expect(defs.find((d) => d.key === 'shirt_size')?.options).toEqual(['Small', 'Medium', 'Large']);
    // TEXT field's options are forced empty even if never passed one -- no leakage
    // from one definition's options into another's.
    expect(defs.find((d) => d.key === 'order_number')?.options).toEqual([]);
  });

  it('rejects a duplicate key with a clean error, not a raw DB constraint message', async () => {
    await expect(
      createCustomFieldDefinition(tenantId, { key: 'order_number', label: 'Dup', fieldType: 'TEXT' }),
    ).rejects.toThrow('a custom field with this key already exists');
  });

  it('PATCH merges into existing customFields instead of replacing it', async () => {
    await updateTicket(tenantId, ticketId, { customFields: { order_number: 'ORD-1' } });
    let ticket = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    expect(ticket.customFields).toEqual({ order_number: 'ORD-1' });

    // A second PATCH setting a DIFFERENT field must not drop the first one.
    await updateTicket(tenantId, ticketId, { customFields: { shirt_size: 'Medium' } });
    ticket = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    expect(ticket.customFields).toEqual({ order_number: 'ORD-1', shirt_size: 'Medium' });

    // Re-setting the same key overwrites just that key.
    await updateTicket(tenantId, ticketId, { customFields: { order_number: 'ORD-2' } });
    ticket = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    expect(ticket.customFields).toEqual({ order_number: 'ORD-2', shirt_size: 'Medium' });
  });
});
