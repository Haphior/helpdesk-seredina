import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createSavedView, deleteSavedView, listSavedViews } from '../src/modules/savedviews/service';
import { createTicketFromApi, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';
import { listTickets } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Saved views', () => {
  let tenantId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `views-${tenantId.slice(0, 8)}`, name: 'Saved Views Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      const a = await tx.user.create({ data: { tenantId, email: 'agent-a@example.com', name: 'Agent A', passwordHash: 'x' } });
      const b = await tx.user.create({ data: { tenantId, email: 'agent-b@example.com', name: 'Agent B', passwordHash: 'x' } });
      userAId = a.id;
      userBId = b.id;
    });
  });

  it('creates a view scoped to the caller, rejects a duplicate name for the same user', async () => {
    const view = await createSavedView(tenantId, userAId, { name: 'My open tickets', filters: { statusCategory: 'OPEN' } });
    expect(view.userId).toBe(userAId);

    await expect(
      createSavedView(tenantId, userAId, { name: 'My open tickets', filters: { priority: 'URGENT' } }),
    ).rejects.toThrow('a saved view with this name already exists');
  });

  it('the same name is fine for a different user -- uniqueness is per-user, not tenant-wide', async () => {
    const view = await createSavedView(tenantId, userBId, { name: 'My open tickets', filters: { statusCategory: 'OPEN' } });
    expect(view.userId).toBe(userBId);
  });

  it('listSavedViews only returns the caller\'s own views, never another user\'s', async () => {
    const viewsA = await listSavedViews(tenantId, userAId);
    const viewsB = await listSavedViews(tenantId, userBId);
    expect(viewsA.every((v) => v.userId === userAId)).toBe(true);
    expect(viewsB.every((v) => v.userId === userBId)).toBe(true);
    expect(viewsA.some((v) => v.id === viewsB[0]?.id)).toBe(false);
  });

  it('deleting another user\'s view is rejected as not found, not as forbidden', async () => {
    const [viewB] = await listSavedViews(tenantId, userBId);
    await expect(deleteSavedView(tenantId, userAId, viewB.id)).rejects.toThrow('saved view not found');

    // The real owner can delete it just fine.
    await deleteSavedView(tenantId, userBId, viewB.id);
    expect(await listSavedViews(tenantId, userBId)).toHaveLength(0);
  });

  it('the filters a view stores actually narrow listTickets when applied', async () => {
    const ticketOpen = await createTicketFromApi(tenantId, {
      subject: 'Open one',
      body: 'body',
      contactEmail: 'c@example.com',
      contactName: 'C',
      priority: 'URGENT',
    });
    const ticketAssigned = await createTicketFromApi(tenantId, {
      subject: 'Assigned to A',
      body: 'body',
      contactEmail: 'c@example.com',
      contactName: 'C',
    });
    await updateTicket(tenantId, ticketAssigned.id, { assigneeId: userAId });

    const [view] = await listSavedViews(tenantId, userAId); // "My open tickets" from the first test, filters: { statusCategory: 'OPEN' }
    const filters = view.filters as { statusCategory?: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED' };
    const { tickets: result } = await listTickets(tenantId, filters);
    expect(result.every((t) => t.status.category === 'OPEN')).toBe(true);
    expect(result.map((t) => t.id)).toContain(ticketOpen.id);

    const assignedToA = await createSavedView(tenantId, userAId, { name: 'Assigned to me', filters: { assigneeId: userAId } });
    const assignedFilters = assignedToA.filters as { assigneeId?: string };
    const { tickets: assignedResult } = await listTickets(tenantId, assignedFilters);
    expect(assignedResult.map((t) => t.id)).toEqual([ticketAssigned.id]);

    const unassigned = await createSavedView(tenantId, userAId, { name: 'Unassigned', filters: { assigneeId: 'unassigned' } });
    const unassignedFilters = unassigned.filters as { assigneeId?: string };
    const { tickets: unassignedResult } = await listTickets(tenantId, unassignedFilters);
    expect(unassignedResult.map((t) => t.id)).not.toContain(ticketAssigned.id);
    expect(unassignedResult.map((t) => t.id)).toContain(ticketOpen.id);
  });
});
