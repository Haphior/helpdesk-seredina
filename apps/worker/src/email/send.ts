import { prisma, withTenantTx } from '@seredina/db';
import { createTransportForChannel, pickSendChannel } from './transport';

export async function sendEmailMessage(tenantId: string, ticketId: string, messageId: string): Promise<void> {
  const data = await withTenantTx(prisma, tenantId, async (tx) => {
    const message = await tx.message.findUniqueOrThrow({ where: { id: messageId } });
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { contact: true } });
    // The mailbox the conversation arrived on, so the reply comes from the address
    // the customer wrote to; otherwise the tenant's first connected channel.
    const channel = pickSendChannel(await tx.emailChannel.findMany({ orderBy: { createdAt: 'asc' } }), ticket.emailChannelId);
    if (!channel) throw new Error('no connected email channel configured for this tenant');

    // The most recent inbound message with a Message-ID drives the In-Reply-To/
    // References headers so the customer's mail client threads the reply correctly.
    const lastInbound = await tx.message.findFirst({
      where: { ticketId, authorType: 'CONTACT', externalId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });

    return { message, ticket, channel, lastInbound };
  });

  const transport = await createTransportForChannel(data.channel);

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
