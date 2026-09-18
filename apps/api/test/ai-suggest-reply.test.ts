import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { TestProviderAdapter } from '@seredina/ai-adapters';
import { addMessage, createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { suggestReply, summarizeTicket } from '../src/modules/ai/service';

/**
 * Uses the same live-Postgres convention as the tenant-isolation suites (skipped
 * entirely without one) -- but this isn't testing isolation, it's the one piece of
 * ai/service.ts logic that actually matters and has no other coverage: the prompt
 * a real ticket thread turns into, specifically that a private note never leaks
 * into a prompt that will hand the model's reply straight back to a customer.
 * No network call -- TestProviderAdapter never talks to Anthropic.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('ai suggest-reply / summarize', () => {
  let tenantId: string;
  let ticketId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `ai-${tenantId.slice(0, 8)}`, name: 'AI Test Tenant' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'VPN keeps disconnecting',
      body: 'My VPN drops every few minutes since this morning.',
      contactEmail: 'customer@example.com',
      contactName: 'Jordan Customer',
    });
    ticketId = ticket.id;

    const agentUserId = await withTenantTx(prisma, tenantId, async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, email: 'agent@example.com', name: 'Agent Smith', passwordHash: 'x' },
      });
      return user.id;
    });

    await addMessage(tenantId, ticketId, {
      authorUserId: agentUserId,
      body: 'Could you tell me which VPN client version you are using?',
      isPrivateNote: false,
    });
    await addMessage(tenantId, ticketId, {
      authorUserId: agentUserId,
      body: 'INTERNAL: this customer is on the legacy client, known bug, do not mention the CVE number.',
      isPrivateNote: true,
    });
  });

  it('suggestReply builds a prompt from the public thread and excludes private notes', async () => {
    const adapter = new TestProviderAdapter(['Thanks for the details -- please try updating your VPN client.']);

    const result = await suggestReply(tenantId, ticketId, adapter);

    expect(result.suggestion).toBe('Thanks for the details -- please try updating your VPN client.');

    const [call] = adapter.getCalls();
    // suggestReply never uses tool-calling messages, so this is always the
    // plain-content variant of the LlmMessage union.
    const prompt = (call.messages[0] as { content: string }).content;
    expect(prompt).toContain('VPN keeps disconnecting');
    expect(prompt).toContain('My VPN drops every few minutes');
    expect(prompt).toContain('Could you tell me which VPN client version');
    expect(prompt).not.toContain('INTERNAL');
    expect(prompt).not.toContain('CVE number');
  });

  it('summarizeTicket also excludes private notes from its prompt', async () => {
    const adapter = new TestProviderAdapter(['Customer reports frequent VPN disconnects; agent is troubleshooting.']);

    const result = await summarizeTicket(tenantId, ticketId, adapter);

    expect(result.summary).toBe('Customer reports frequent VPN disconnects; agent is troubleshooting.');

    const [call] = adapter.getCalls();
    expect((call.messages[0] as { content: string }).content).not.toContain('INTERNAL');
  });

  it('throws for a ticket that does not exist', async () => {
    const adapter = new TestProviderAdapter(['unused']);
    await expect(suggestReply(tenantId, randomUUID(), adapter)).rejects.toThrow('ticket not found');
  });
});
