import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { addMessage, getTicket, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { addWidgetMessage, getWidgetConversation, startWidgetConversation } from '../src/modules/widget/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Embeddable widget channel (Phase 4)', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `widget-${tenantId.slice(0, 8)}`, name: 'Widget Test Tenant' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('starts a conversation as a real ticket with a widgetToken and a CONTACT opening message', async () => {
    const result = await startWidgetConversation(tenantId, {
      name: 'Jane Visitor',
      email: 'jane@visitor.example',
      message: 'Hi, I need help with my order\nIt never arrived',
    });

    expect(result.widgetToken).toHaveLength(64);
    const ticket = await getTicket(tenantId, result.ticketId);
    expect(ticket.channel).toBe('widget');
    expect(ticket.subject).toBe('Hi, I need help with my order');
    expect(ticket.contact.email).toBe('jane@visitor.example');
    expect(ticket.messages[0].authorType).toBe('CONTACT');
    expect(ticket.messages[0].body).toBe('Hi, I need help with my order\nIt never arrived');
  });

  it('a follow-up message via addWidgetMessage appends a real CONTACT message on the same ticket', async () => {
    const { ticketId, widgetToken } = await startWidgetConversation(tenantId, {
      name: 'Jane',
      email: 'jane@visitor.example',
      message: 'First message',
    });

    await addWidgetMessage(tenantId, widgetToken, 'Second message');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.messages).toHaveLength(2);
    expect(ticket.messages[1].authorType).toBe('CONTACT');
    expect(ticket.messages[1].body).toBe('Second message');
  });

  it('a CONTACT follow-up never stamps firstRespondedAt -- that bug would have counted the customer as their own first responder', async () => {
    const { ticketId, widgetToken } = await startWidgetConversation(tenantId, {
      name: 'Jane',
      email: 'jane@visitor.example',
      message: 'First message',
    });
    await addWidgetMessage(tenantId, widgetToken, 'Second message');

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.firstRespondedAt).toBeNull();
  });

  it('a real agent reply on the same ticket does stamp firstRespondedAt -- proves the guard is authorType-specific, not disabled outright', async () => {
    const { ticketId } = await startWidgetConversation(tenantId, {
      name: 'Jane',
      email: 'jane@visitor.example',
      message: 'First message',
    });

    const agentId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { id: agentId, tenantId, email: 'agent@test.example', name: 'Agent', passwordHash: 'x' } }),
    );
    await addMessage(tenantId, ticketId, { body: 'We are on it', authorUserId: agentId, isPrivateNote: false });

    const ticket = await getTicket(tenantId, ticketId);
    expect(ticket.firstRespondedAt).not.toBeNull();
  });

  it('getWidgetConversation returns messages in order and excludes private notes', async () => {
    const { ticketId, widgetToken } = await startWidgetConversation(tenantId, {
      name: 'Jane',
      email: 'jane@visitor.example',
      message: 'First message',
    });
    const agentId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.user.create({ data: { id: agentId, tenantId, email: 'agent2@test.example', name: 'Agent', passwordHash: 'x' } }),
    );
    await addMessage(tenantId, ticketId, { body: 'internal note about this customer', isPrivateNote: true, authorUserId: agentId });
    await addMessage(tenantId, ticketId, { body: 'Public reply', authorUserId: agentId, isPrivateNote: false });

    const view = await getWidgetConversation(tenantId, widgetToken);
    expect(view.messages.map((m) => m.body)).toEqual(['First message', 'Public reply']);
  });

  it('an unknown widgetToken is rejected the same way as any other lookup failure', async () => {
    await expect(getWidgetConversation(tenantId, 'not-a-real-token')).rejects.toThrow('conversation not found');
    await expect(addWidgetMessage(tenantId, 'not-a-real-token', 'hi')).rejects.toThrow('conversation not found');
  });

  it('a widgetToken from tenant A is invisible under tenant B -- RLS scoping applies to this lookup like any other', async () => {
    const { widgetToken } = await startWidgetConversation(tenantId, {
      name: 'Jane',
      email: 'jane@visitor.example',
      message: 'First message',
    });

    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, slug: `widget-other-${otherTenantId.slice(0, 8)}`, name: 'Other Tenant' } });
      await seedDefaultTicketStatuses(tx, otherTenantId);
    });

    await expect(getWidgetConversation(otherTenantId, widgetToken)).rejects.toThrow('conversation not found');
  });
});
