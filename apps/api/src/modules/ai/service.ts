import { prisma, withTenantTx } from '@seredina/db';
import type { LlmProviderAdapter } from '@seredina/ai-adapters';

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

  return { summary: result.text };
}
