import { prisma, withTenantTx } from '@seredina/db';
import { publishLive } from '../lib/live';

export interface InboundEmail {
  tenantId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
}

export interface AssigneeNotice {
  userId: string;
  ticketNumber: number;
  ticketSubject: string;
}

export interface IngestResult {
  ticketId: string;
  // Set only when this reply landed on an EXISTING, already-assigned ticket --
  // a brand new ticket has no assignee yet. The caller notifies AFTER this
  // transaction closes (see poll.ts) -- see docs/adr/0022-notifications.md.
  assigneeToNotify: AssigneeNotice | null;
}

/**
 * Threads a reply onto its existing ticket by matching In-Reply-To/References
 * against a stored Message.externalId (set on both inbound and outbound messages --
 * see send.ts); no match means a new conversation, so a new Ticket. Unlike alert
 * ingestion's dedup (docs/adr/0003-alert-ingestion.md), a reply to a CLOSED ticket's
 * thread reopens it rather than starting a new ticket -- it's the same conversation
 * either way, not a new occurrence of a recurring problem the way a re-fired
 * monitoring alert is.
 */
export async function ingestInboundEmail(email: InboundEmail): Promise<IngestResult> {
  let createdTicket = false;
  const result = await withTenantTx(prisma, email.tenantId, async (tx) => {
    const candidateIds = [email.inReplyTo, ...email.references].filter((v): v is string => Boolean(v));

    const existingMessage =
      candidateIds.length > 0
        ? await tx.message.findFirst({
            where: { externalId: { in: candidateIds } },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    const contact = await tx.contact.upsert({
      where: { tenantId_email: { tenantId: email.tenantId, email: email.fromAddress } },
      create: { tenantId: email.tenantId, email: email.fromAddress, name: email.fromName || email.fromAddress },
      update: { name: email.fromName || email.fromAddress },
    });

    let ticketId: string;
    let assigneeToNotify: AssigneeNotice | null = null;

    if (existingMessage) {
      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id: existingMessage.ticketId },
        include: { status: true },
      });
      ticketId = ticket.id;

      if (ticket.status.category === 'CLOSED') {
        const openStatus = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
        if (openStatus) {
          await tx.ticket.update({ where: { id: ticketId }, data: { statusId: openStatus.id, closedAt: null } });
        }
      }

      if (ticket.assigneeId) {
        assigneeToNotify = { userId: ticket.assigneeId, ticketNumber: ticket.number, ticketSubject: ticket.subject };
      }
    } else {
      const openStatus = await tx.ticketStatus.findFirst({ where: { key: 'open' } });
      if (!openStatus) throw new Error('tenant has no "open" ticket status configured');

      const tenant = await tx.tenant.update({
        where: { id: email.tenantId },
        data: { lastTicketNumber: { increment: 1 } },
      });

      const ticket = await tx.ticket.create({
        data: {
          tenantId: email.tenantId,
          number: tenant.lastTicketNumber,
          subject: email.subject || '(no subject)',
          statusId: openStatus.id,
          contactId: contact.id,
          channel: 'email',
        },
      });
      ticketId = ticket.id;
      createdTicket = true;
    }

    await tx.message.create({
      data: {
        tenantId: email.tenantId,
        ticketId,
        authorType: 'CONTACT',
        body: email.text,
        isPrivateNote: false,
        externalId: email.messageId,
      },
    });

    return { ticketId, assigneeToNotify };
  });

  // After the commit, never inside it -- see docs/adr/0053-live-updates.md.
  await publishLive(email.tenantId, { type: createdTicket ? 'ticket.created' : 'message.created', ticketId: result.ticketId });
  return result;
}
