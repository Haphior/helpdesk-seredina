import { Prisma } from '@prisma/client';

/**
 * Erases a contact's personal data -- docs/adr/0066-contact-data-rights.md.
 *
 * Shared by the API (an admin acting on a request) and the worker (automatic
 * retention), so both erase exactly the same things. Runs inside the caller's
 * tenant-scoped transaction.
 *
 * What goes: the contact's name and email, and everything written on their
 * tickets -- subject, every message body (agent replies and internal notes
 * quote the customer too), attachments, custom field values, AI triage
 * reasoning, the CSAT comment, AI agent tool arguments/results, and the
 * in-app notifications about those tickets.
 *
 * What stays: the tickets themselves as empty shells (number, status,
 * priority, team, assignee, channel, dates, SLA timestamps, CSAT rating), so
 * reports and SLA statistics don't change after the fact.
 */
export const ANONYMIZED_CONTACT_NAME = 'Anonymized contact';
export const ANONYMIZED_TICKET_SUBJECT = '[anonymized]';
export const ANONYMIZED_MESSAGE_BODY = '[Removed at the customer’s request]';

export interface ContactErasureResult {
  alreadyAnonymized: boolean;
  tickets: number;
  messages: number;
  attachments: number;
}

export function anonymizedContactEmail(contactId: string): string {
  // Keeps the (tenant, email) unique constraint satisfied, and .invalid can
  // never receive mail (RFC 2606), so nothing is ever sent to it.
  return `anonymized-${contactId}@anonymized.invalid`;
}

export async function anonymizeContactInTx(
  tx: Prisma.TransactionClient,
  contactId: string,
  now: Date = new Date(),
): Promise<ContactErasureResult> {
  const contact = await tx.contact.findUnique({ where: { id: contactId }, select: { id: true, anonymizedAt: true } });
  if (!contact) throw new Error('contact not found');
  if (contact.anonymizedAt) return { alreadyAnonymized: true, tickets: 0, messages: 0, attachments: 0 };

  const tickets = await tx.ticket.findMany({ where: { contactId }, select: { id: true } });
  const ticketIds = tickets.map((t) => t.id);

  let messages = 0;
  let attachments = 0;
  if (ticketIds.length > 0) {
    attachments = (await tx.attachment.deleteMany({ where: { message: { ticketId: { in: ticketIds } } } })).count;
    messages = (
      await tx.message.updateMany({
        where: { ticketId: { in: ticketIds } },
        data: { body: ANONYMIZED_MESSAGE_BODY, externalId: null },
      })
    ).count;
    await tx.ticket.updateMany({
      where: { id: { in: ticketIds } },
      data: {
        subject: ANONYMIZED_TICKET_SUBJECT,
        customFields: Prisma.DbNull,
        aiTriage: Prisma.DbNull,
        widgetToken: null,
        externalId: null,
      },
    });
    await tx.csatResponse.updateMany({ where: { ticketId: { in: ticketIds } }, data: { comment: null } });
    await tx.aiAgentRun.updateMany({
      where: { ticketId: { in: ticketIds } },
      data: { args: {}, result: Prisma.DbNull, errorMessage: null },
    });
    await tx.notification.updateMany({ where: { ticketId: { in: ticketIds } }, data: { body: ANONYMIZED_TICKET_SUBJECT } });
  }

  await tx.contact.update({
    where: { id: contactId },
    data: { name: ANONYMIZED_CONTACT_NAME, email: anonymizedContactEmail(contactId), anonymizedAt: now },
  });

  return { alreadyAnonymized: false, tickets: ticketIds.length, messages, attachments };
}
