import { prisma, withTenantTx } from '@seredina/db';
import type { ContactEmailJobPayload } from '@seredina/shared';
import { createTransportForChannel, pickSendChannel } from './transport';

/** A one-off email to a contact, e.g. a customer-portal sign-in link (docs/adr/0063-customer-portal.md). */
export async function sendContactEmail(payload: ContactEmailJobPayload): Promise<void> {
  const channel = await withTenantTx(prisma, payload.tenantId, async (tx) =>
    pickSendChannel(await tx.emailChannel.findMany({ orderBy: { createdAt: 'asc' } }), null),
  );
  if (!channel) throw new Error('no connected email channel configured for this tenant');
  const transport = await createTransportForChannel(channel);
  await transport.sendMail({ from: channel.fromAddress, to: payload.to, subject: payload.subject, text: payload.text });
}
