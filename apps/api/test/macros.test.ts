import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { applyMacro, createMacro, deleteMacro } from '../src/modules/macros/service';

// No hasRedis guard needed: updateTicket/addMessage's webhook dispatch is a no-op
// (never touches Redis) when the tenant has zero webhooks configured, which this
// test tenant does -- same short-circuit already proven in test/webhooks.test.ts.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('macros', () => {
  let tenantId: string;
  let ticketId: string;
  let pendingStatusId: string;
  let agentUserId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `macro-${tenantId.slice(0, 8)}`, name: 'Macro Test' } }),
    );
    await withTenantTx(prisma, tenantId, (tx) => seedDefaultTicketStatuses(tx, tenantId));

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Macro test ticket',
      body: 'body',
      contactEmail: 'macro-test@example.com',
      contactName: 'Macro Test',
    });
    ticketId = ticket.id;

    pendingStatusId = await withTenantTx(prisma, tenantId, async (tx) => {
      const status = await tx.ticketStatus.findFirstOrThrow({ where: { key: 'pending' } });
      return status.id;
    });

    agentUserId = await withTenantTx(prisma, tenantId, async (tx) => {
      const user = await tx.user.create({ data: { tenantId, email: 'agent@example.com', name: 'Agent', passwordHash: 'x' } });
      return user.id;
    });
  });

  it('rejects a macro with no actions and a duplicate name', async () => {
    await expect(createMacro(tenantId, { name: 'Empty', actions: {} })).rejects.toThrow(
      'a macro needs at least one action',
    );

    await createMacro(tenantId, { name: 'Set to pending', actions: { setStatusId: pendingStatusId } });
    await expect(
      createMacro(tenantId, { name: 'Set to pending', actions: { setPriority: 'HIGH' } }),
    ).rejects.toThrow('a macro with this name already exists');
  });

  it('applying a macro updates the ticket via the real updateTicket path (status, priority, team all at once)', async () => {
    const macro = await createMacro(tenantId, {
      name: 'Escalate',
      actions: { setStatusId: pendingStatusId, setPriority: 'URGENT' },
    });

    await applyMacro(tenantId, ticketId, macro.id, agentUserId);

    const ticket = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    expect(ticket.statusId).toBe(pendingStatusId);
    expect(ticket.priority).toBe('URGENT');
  });

  it('a macro with addReply posts a real message via addMessage (shows up in the thread)', async () => {
    const macro = await createMacro(tenantId, {
      name: 'Canned ack',
      actions: { addReply: { body: 'Thanks, we are on it.', isPrivateNote: false } },
    });

    await applyMacro(tenantId, ticketId, macro.id, agentUserId);

    const messages = await withTenantTx(prisma, tenantId, (tx) => tx.message.findMany({ where: { ticketId } }));
    expect(messages.some((m) => m.body === 'Thanks, we are on it.' && !m.isPrivateNote)).toBe(true);
  });

  it('throws for a macro that does not exist, and for deleting one that does not exist', async () => {
    await expect(applyMacro(tenantId, ticketId, randomUUID(), agentUserId)).rejects.toThrow('macro not found');
    await expect(deleteMacro(tenantId, randomUUID())).rejects.toThrow('macro not found');
  });
});
