import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  createTicketFromApi,
  createTicketStatus,
  deleteTicketStatus,
  listTicketStatuses,
  seedDefaultTicketStatuses,
  updateTicketStatus,
} from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Ticket Status configuration', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `statuses-${tenantId.slice(0, 8)}`, name: 'Statuses Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('creates a custom status, appended after the seeded defaults', async () => {
    const created = await createTicketStatus(tenantId, { key: 'waiting_on_vendor', label: 'Waiting on Vendor', category: 'PENDING' });
    expect(created.sortOrder).toBe(4); // after the 4 seeded defaults
    const all = await listTicketStatuses(tenantId);
    expect(all.map((s) => s.key)).toContain('waiting_on_vendor');
  });

  it('rejects a duplicate key', async () => {
    await expect(createTicketStatus(tenantId, { key: 'open', label: 'Reopened', category: 'OPEN' })).rejects.toThrow(
      'a status with this key already exists',
    );
  });

  it('updates label/category/sortOrder but the key stays fixed', async () => {
    const status = await createTicketStatus(tenantId, { key: 'escalated', label: 'Escalated', category: 'OPEN' });
    const updated = await updateTicketStatus(tenantId, status.id, { label: 'Escalated to L2', category: 'PENDING', sortOrder: 9 });
    expect(updated.label).toBe('Escalated to L2');
    expect(updated.category).toBe('PENDING');
    expect(updated.sortOrder).toBe(9);
    expect(updated.key).toBe('escalated');
  });

  it('refuses to recategorize the "open" status away from OPEN', async () => {
    const statuses = await listTicketStatuses(tenantId);
    const open = statuses.find((s) => s.key === 'open');
    if (!open) throw new Error('expected an "open" status to exist');
    await expect(updateTicketStatus(tenantId, open.id, { category: 'PENDING' })).rejects.toThrow(
      'the "open" status must stay in the OPEN category',
    );
  });

  it('refuses to delete the "open" status', async () => {
    const statuses = await listTicketStatuses(tenantId);
    const open = statuses.find((s) => s.key === 'open');
    if (!open) throw new Error('expected an "open" status to exist');
    await expect(deleteTicketStatus(tenantId, open.id)).rejects.toThrow('the "open" status can\'t be deleted');
  });

  it('refuses to delete a status with tickets currently in it, but allows it once empty', async () => {
    const status = await createTicketStatus(tenantId, { key: 'in_review', label: 'In Review', category: 'PENDING' });
    const ticket = await createTicketFromApi(tenantId, { subject: 'x', body: 'b', contactEmail: 'c@example.com', contactName: 'C' });
    await withTenantTx(prisma, tenantId, (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { statusId: status.id } }));

    await expect(deleteTicketStatus(tenantId, status.id)).rejects.toThrow('currently in this status');

    const openStatuses = await listTicketStatuses(tenantId);
    const open = openStatuses.find((s) => s.key === 'open');
    if (!open) throw new Error('expected an "open" status to exist');
    await withTenantTx(prisma, tenantId, (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { statusId: open.id } }));

    await deleteTicketStatus(tenantId, status.id);
    expect((await listTicketStatuses(tenantId)).map((s) => s.id)).not.toContain(status.id);
  });

  it('reorders via the sortOrder-swap pattern', async () => {
    const freshTenantId = randomUUID();
    await withTenantTx(prisma, freshTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: freshTenantId, slug: `statuses-order-${freshTenantId.slice(0, 8)}`, name: 'Order' } });
      await seedDefaultTicketStatuses(tx, freshTenantId);
    });
    const before = await listTicketStatuses(freshTenantId);
    const [first, second] = before;
    await Promise.all([
      updateTicketStatus(freshTenantId, first.id, { sortOrder: second.sortOrder }),
      updateTicketStatus(freshTenantId, second.id, { sortOrder: first.sortOrder }),
    ]);
    const after = await listTicketStatuses(freshTenantId);
    expect(after[0].id).toBe(second.id);
    expect(after[1].id).toBe(first.id);
  });
});
