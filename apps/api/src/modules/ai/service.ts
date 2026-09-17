import { prisma, withTenantTx } from '@seredina/db';
import { estimateCostUsd, type CompleteResult, type LlmProviderAdapter } from '@seredina/ai-adapters';

const SUGGEST_REPLY_SYSTEM = `You are helping a support agent at an IT helpdesk draft a reply to a customer.
Be concise, professional, and warm. Never invent facts that aren't in the ticket thread -- if the
customer asked something the thread doesn't answer, say the agent should look into it rather than
guessing. Write only the reply body, no greeting boilerplate like "Dear customer," no signature.`;

const SUMMARIZE_SYSTEM = `You summarize IT helpdesk ticket threads for a teammate picking up the ticket.
Two to three sentences: what the customer needs, what's been tried, what's still open. No preamble.`;

async function loadTicketThread(tenantId: string, ticketId: string) {
  const ticket = await withTenantTx(prisma, tenantId, async (tx) =>
    tx.ticket.findUnique({
      where: { id: ticketId },
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { authorUser: { select: { name: true } } },
        },
      },
    }),
  );
  if (!ticket) throw new Error('ticket not found');

  // Internal notes are agent-only context, not part of the customer conversation --
  // excluded so a reply suggestion never accidentally surfaces private commentary.
  const thread = ticket.messages
    .filter((m) => !m.isPrivateNote)
    .map((m) => {
      const speaker = m.authorType === 'CONTACT' ? ticket.contact.name : (m.authorUser?.name ?? 'Agent');
      return `${speaker}: ${m.body}`;
    })
    .join('\n\n');

  return { ticket, thread };
}

/**
 * Written right after adapter.complete() returns -- real token counts and the
 * model that actually served the call, never estimated after the fact. See
 * docs/adr/0023-ai-cost-transparency.md. A separate short transaction, not
 * inside the same tx as the (already-closed) thread read -- this only runs
 * after the network call, and network I/O never belongs inside withTenantTx.
 */
async function logAiUsage(tenantId: string, ticketId: string, action: string, result: CompleteResult) {
  const estimatedCostUsd = estimateCostUsd(result.model, result.inputTokens, result.outputTokens);
  await withTenantTx(prisma, tenantId, (tx) =>
    tx.aiUsageLog.create({
      data: {
        tenantId,
        ticketId,
        action,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd,
      },
    }),
  );
}

export async function suggestReply(
  tenantId: string,
  ticketId: string,
  adapter: LlmProviderAdapter,
): Promise<{ suggestion: string }> {
  const { ticket, thread } = await loadTicketThread(tenantId, ticketId);

  const result = await adapter.complete({
    system: SUGGEST_REPLY_SYSTEM,
    maxTokens: 500,
    messages: [
      {
        role: 'user',
        content: `Ticket subject: ${ticket.subject}\n\nConversation so far:\n${thread || '(no messages yet)'}\n\nDraft the agent's next reply.`,
      },
    ],
  });
  await logAiUsage(tenantId, ticketId, 'suggest_reply', result);

  return { suggestion: result.text };
}

export async function summarizeTicket(
  tenantId: string,
  ticketId: string,
  adapter: LlmProviderAdapter,
): Promise<{ summary: string }> {
  const { ticket, thread } = await loadTicketThread(tenantId, ticketId);

  const result = await adapter.complete({
    system: SUMMARIZE_SYSTEM,
    maxTokens: 250,
    messages: [
      {
        role: 'user',
        content: `Ticket subject: ${ticket.subject}\n\nConversation so far:\n${thread || '(no messages yet)'}`,
      },
    ],
  });
  await logAiUsage(tenantId, ticketId, 'summarize', result);

  return { summary: result.text };
}

export async function getTicketAiUsage(tenantId: string, ticketId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const logs = await tx.aiUsageLog.findMany({ where: { ticketId }, orderBy: { createdAt: 'desc' } });
    const totalCostUsd = logs.reduce((sum, l) => sum + Number(l.estimatedCostUsd ?? 0), 0);
    return { logs, totalCalls: logs.length, totalCostUsd };
  });
}

/** Tenant-wide, not per-agent -- this is financial visibility for whoever manages the tenant, not a personal stat. */
export async function getAiUsageSummary(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const logs = await tx.aiUsageLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: { ticket: { select: { id: true, number: true, subject: true } } },
    });

    const totalCalls = logs.length;
    const totalCostUsd = logs.reduce((sum, l) => sum + Number(l.estimatedCostUsd ?? 0), 0);

    const byActionMap = new Map<string, { calls: number; costUsd: number }>();
    for (const log of logs) {
      const entry = byActionMap.get(log.action) ?? { calls: 0, costUsd: 0 };
      entry.calls += 1;
      entry.costUsd += Number(log.estimatedCostUsd ?? 0);
      byActionMap.set(log.action, entry);
    }
    const byAction = [...byActionMap.entries()].map(([action, v]) => ({ action, ...v }));

    return { totalCalls, totalCostUsd, byAction, recent: logs.slice(0, 20) };
  });
}
