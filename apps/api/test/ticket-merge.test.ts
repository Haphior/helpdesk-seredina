import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, getTicket, mergeTicket, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Ticket merge', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `merge-${tenantId.slice(0, 8)}`, name: 'Merge Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  async function ticket(subject: string) {
    return createTicketFromApi(tenantId, { subject, body: 'body', contactEmail: 'a@example.com', contactName: 'A' });
  }

  it('moves the source ticket\'s messages onto the target and adds a system note on each side', async () => {
    const source = await ticket('Printer jammed');
    const target = await ticket('Printer troubleshooting thread');

    const merged = await mergeTicket(tenantId, source.id, target.id);
    expect(merged.mergedIntoId).toBe(target.id);
    expect(merged.closedAt).not.toBeNull();

    const fetchedTarget = await getTicket(tenantId, target.id);
    const fetchedSource = await getTicket(tenantId, source.id);
    expect(fetchedSource.status.category).toBe('CLOSED');

    // The source's original CONTACT message moved onto the target...
    expect(fetchedTarget.messages.some((m) => m.body === 'body' && m.authorType === 'CONTACT')).toBe(true);
    // ...so the source itself has only the one new "merged into" system note left.
    expect(fetchedSource.messages).toHaveLength(1);
    expect(fetchedSource.messages[0].authorType).toBe('SYSTEM');
    expect(fetchedSource.messages[0].body).toContain(`#${target.number}`);
    expect(fetchedTarget.messages.some((m) => m.authorType === 'SYSTEM' && m.body.includes(`#${source.number}`))).toBe(true);
  });

  it('closes the source and sets resolvedAt if it was not already set', async () => {
    const source = await ticket('Duplicate report');
    const target = await ticket('Original report');
    expect(source.resolvedAt).toBeNull();

    const merged = await mergeTicket(tenantId, source.id, target.id);
    expect(merged.closedAt).not.toBeNull();
    expect(merged.resolvedAt).not.toBeNull();
  });

  it('getTicket on the target lists the source in mergedTickets', async () => {
    const source = await ticket('Same issue reported again');
    const target = await ticket('Canonical issue thread');
    await mergeTicket(tenantId, source.id, target.id);

    const fetchedTarget = await getTicket(tenantId, target.id);
    expect(fetchedTarget.mergedTickets.map((t) => t.id)).toContain(source.id);
  });

  it('rejects merging a ticket into itself', async () => {
    const t = await ticket('Solo ticket');
    await expect(mergeTicket(tenantId, t.id, t.id)).rejects.toThrow('cannot merge a ticket into itself');
  });

  it('rejects merging an already-merged ticket again, and rejects merging into an already-merged ticket', async () => {
    const a = await ticket('A');
    const b = await ticket('B');
    const c = await ticket('C');
    await mergeTicket(tenantId, a.id, b.id);

    await expect(mergeTicket(tenantId, a.id, c.id)).rejects.toThrow('this ticket has already been merged into another one');
    await expect(mergeTicket(tenantId, c.id, a.id)).rejects.toThrow(
      'cannot merge into a ticket that has itself been merged elsewhere',
    );
  });

  it('rejects a nonexistent source or target', async () => {
    const t = await ticket('Real ticket');
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await expect(mergeTicket(tenantId, fakeId, t.id)).rejects.toThrow('source ticket not found');
    await expect(mergeTicket(tenantId, t.id, fakeId)).rejects.toThrow('target ticket not found');
  });
});
