import nodemailer from 'nodemailer';
import { prisma, withTenantTx } from '@seredina/db';
import { decryptSecret } from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

export async function sendEmailMessage(tenantId: string, ticketId: string, messageId: string): Promise<void> {
  const data = await withTenantTx(prisma, tenantId, async (tx) => {
    const message = await tx.message.findUniqueOrThrow({ where: { id: messageId } });
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { contact: true } });
    // v1: the tenant's first active email channel -- a ticket doesn't remember which
    // specific channel it arrived through yet (only one is expected in practice for
    // now). See docs/adr/0004-email-channel.md.
    const channel = await tx.emailChannel.findFirst({ where: { isActive: true } });
    if (!channel) throw new Error('no active email channel configured for this tenant');

    // The most recent inbound message with a Message-ID drives the In-Reply-To/
    // References headers so the customer's mail client threads the reply correctly.
    const lastInbound = await tx.message.findFirst({
      where: { ticketId, authorType: 'CONTACT', externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });

    return { message, ticket, channel, lastInbound };
  });

  const password = decryptSecret(data.channel.smtpPasswordEncrypted, ENCRYPTION_KEY!);
  const transport = nodemailer.createTransport({
    host: data.channel.smtpHost,
    port: data.channel.smtpPort,
    secure: data.channel.smtpSecure,
    auth: { user: data.channel.smtpUsername, pass: password },
  });

  // Stored as this outbound message's own externalId below -- if the customer
  // replies to THIS email, its In-Reply-To will carry this id and ingest.ts's
  // threading match finds it.
  const outboundMessageId = `<${data.message.id}@seredina>`;

  await transport.sendMail({
    from: data.channel.fromAddress,
    to: data.ticket.contact.email,
    subject: `Re: [#${data.ticket.number}] ${data.ticket.subject}`,
    text: data.message.body,
    messageId: outboundMessageId,
    inReplyTo: data.lastInbound?.externalId ?? undefined,
    references: data.lastInbound?.externalId ? [data.lastInbound.externalId] : undefined,
  });

  await withTenantTx(prisma, tenantId, (tx) =>
    tx.message.update({ where: { id: messageId }, data: { externalId: outboundMessageId } }),
  );
}
