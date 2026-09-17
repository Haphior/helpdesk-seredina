import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { TestProviderAdapter } from '@seredina/ai-adapters';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { getAiUsageSummary, getTicketAiUsage, suggestReply, summarizeTicket } from '../src/modules/ai/service';

/**
 * TestProviderAdapter reports model: 'test-model' (see
 * packages/ai-adapters/src/testAdapter.ts), which packages/ai-adapters/src/
 * pricing.ts deliberately doesn't recognize -- these tests double as coverage
 * that an unpriced model logs real token counts with a null cost rather than
 * a guessed number. See docs/adr/0023-ai-cost-transparency.md.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('AI cost transparency', () => {
  let tenantId: string;
  let ticketId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `aiu-${tenantId.slice(0, 8)}`, name: 'AI Usage Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'AI usage test ticket',
      body: 'body',
      contactEmail: 'c@example.com',
      contactName: 'C',
    });
    ticketId = ticket.id;
  });

  it('suggestReply logs a usage row with real token counts and a null cost for an unpriced model', async () => {
    const adapter = new TestProviderAdapter(['a suggested reply']);
    await suggestReply(tenantId, ticketId, adapter);

    const usage = await getTicketAiUsage(tenantId, ticketId);
    const row = usage.logs.find((l) => l.action === 'suggest_reply');
    expect(row).toBeDefined();
    expect(row!.model).toBe('test-model');
    expect(row!.inputTokens).toBeGreaterThan(0);
    expect(row!.outputTokens).toBeGreaterThan(0);
    expect(row!.estimatedCostUsd).toBeNull();
  });

  it('summarizeTicket logs its own row, distinct action from suggest_reply', async () => {
    const adapter = new TestProviderAdapter(['a summary']);
    await summarizeTicket(tenantId, ticketId, adapter);

    const usage = await getTicketAiUsage(tenantId, ticketId);
    expect(usage.logs.filter((l) => l.action === 'summarize')).toHaveLength(1);
    expect(usage.logs.filter((l) => l.action === 'suggest_reply').length).toBeGreaterThanOrEqual(1);
    expect(usage.totalCalls).toBe(usage.logs.length);
  });

  it('the tenant-wide summary aggregates by action across tickets', async () => {
    const otherTicket = await createTicketFromApi(tenantId, {
      subject: 'Second ticket',
      body: 'body',
      contactEmail: 'c2@example.com',
      contactName: 'C2',
    });
    await suggestReply(tenantId, otherTicket.id, new TestProviderAdapter(['reply']));

    const summary = await getAiUsageSummary(tenantId);
    expect(summary.totalCalls).toBeGreaterThanOrEqual(3);
    const suggestReplyBucket = summary.byAction.find((b) => b.action === 'suggest_reply');
    expect(suggestReplyBucket).toBeDefined();
    expect(suggestReplyBucket!.calls).toBeGreaterThanOrEqual(2);
    // Every log in this suite uses the unpriced test-model, so total cost stays 0 --
    // confirms the summary never substitutes a guessed number for a null one.
    expect(summary.totalCostUsd).toBe(0);
  });

  it('a ticket with no AI activity reports zero usage, not an error', async () => {
    const quietTicket = await createTicketFromApi(tenantId, {
      subject: 'Never touched by AI',
      body: 'body',
      contactEmail: 'c3@example.com',
      contactName: 'C3',
    });
    const usage = await getTicketAiUsage(tenantId, quietTicket.id);
    expect(usage).toEqual({ logs: [], totalCalls: 0, totalCostUsd: 0 });
  });
});
