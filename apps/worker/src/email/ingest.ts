import { prisma, withTenantTx } from '@seredina/db';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_SIZE_BYTES } from '@seredina/shared';
import { publishLive } from '../lib/live';
import { ticketFollowupQueue } from '../lib/queue';

export interface InboundAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
  /** An inline image referenced from the HTML body (a pasted screenshot, a signature logo). */
  inline: boolean;
}

export interface InboundEmail {
  tenantId: string;
  fromAddress: string;
  fromName: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  /** The mailbox it arrived on -- replies go back out through the same one. */
  emailChannelId?: string | null;
  attachments?: InboundAttachment[];
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
  const { kept, skippedNote } = selectInboundAttachments(email.attachments ?? []);
  let duplicate = false;
  const result = await withTenantTx(prisma, email.tenantId, async (tx) => {
    // Idempotent on Message-ID: a replica that dies after ingesting but before
    // flagging the mail \Seen would otherwise create it again on the next poll.
    const alreadyIngested = await tx.message.findFirst({
      where: { externalId: email.messageId, authorType: 'CONTACT' },
      select: { ticketId: true },
    });
    if (alreadyIngested) {
      duplicate = true;
      return { ticketId: alreadyIngested.ticketId, assigneeToNotify: null };
    }

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

      if (!ticket.emailChannelId && email.emailChannelId) {
        await tx.ticket.update({ where: { id: ticketId }, data: { emailChannelId: email.emailChannelId } });
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
          emailChannelId: email.emailChannelId ?? null,
        },
      });
      ticketId = ticket.id;
      createdTicket = true;
    }

    const message = await tx.message.create({
      data: {
        tenantId: email.tenantId,
        ticketId,
        authorType: 'CONTACT',
        body: skippedNote ? `${email.text}\n\n${skippedNote}` : email.text,
        isPrivateNote: false,
        externalId: email.messageId,
      },
    });

    for (const a of kept) {
      await tx.attachment.create({
        data: {
          tenantId: email.tenantId,
          messageId: message.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.data.byteLength,
          data: a.data,
        },
      });
    }

    return { ticketId, assigneeToNotify };
  });

  if (duplicate) return result;

  // After the commit, never inside it -- see docs/adr/0053-live-updates.md.
  await publishLive(email.tenantId, { type: createdTicket ? 'ticket.created' : 'message.created', ticketId: result.ticketId });
  if (createdTicket) {
    // SLA clock, ticket.created webhook and AI triage live in apps/api's ticket
    // service -- see docs/adr/0063-ai-triage.md. Best-effort: the ticket exists
    // either way.
    await ticketFollowupQueue
      .add(
        'followup',
        { tenantId: email.tenantId, ticketId: result.ticketId, finalize: true },
        { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000 },
      )
      .catch((err) => console.error(`[worker] could not queue follow-up for ticket ${result.ticketId}:`, err));
  }
  return result;
}

/**
 * Same caps as a manual upload (packages/shared/src/attachments.ts). Real
 * attachments are kept before inline images, so a signature logo can't push
 * out the file the customer actually sent. Whatever doesn't fit is named in a
 * note on the message instead of disappearing silently -- see
 * docs/adr/0058-inbound-email-attachments.md.
 */
export function selectInboundAttachments(attachments: InboundAttachment[]): {
  kept: InboundAttachment[];
  skippedNote: string | null;
} {
  const ordered = [...attachments.filter((a) => !a.inline), ...attachments.filter((a) => a.inline)];
  const kept: InboundAttachment[] = [];
  const skipped: string[] = [];

  for (const a of ordered) {
    if (a.data.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
      skipped.push(`${a.filename} (${(a.data.byteLength / (1024 * 1024)).toFixed(1)} MB, over the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)} MB limit)`);
    } else if (kept.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      // Inline images past the cap are almost always signature logos -- not worth a note.
      if (!a.inline) skipped.push(`${a.filename} (more than ${MAX_ATTACHMENTS_PER_MESSAGE} attachments)`);
    } else {
      kept.push(a);
    }
  }

  return {
    kept,
    skippedNote: skipped.length > 0 ? `[Attachments not saved: ${skipped.join('; ')}]` : null,
  };
}
