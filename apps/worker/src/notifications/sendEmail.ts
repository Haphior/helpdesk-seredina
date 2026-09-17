import { prisma, withTenantTx } from '@seredina/db';
import type { NotificationEmailJobPayload } from '@seredina/shared';
import { createTransportForChannel } from '../email/transport';

/**
 * Consumes NOTIFICATION_EMAIL_QUEUE_NAME regardless of which app produced the
 * job -- apps/api (TICKET_ASSIGNED) and apps/worker itself (NEW_REPLY) both
 * enqueue onto it. Silently no-ops if the tenant has no active EmailChannel
 * (a notification email is best-effort, unlike the ticket-reply email path in
 * send.ts, which throws when there's no channel to send through) -- see
 * docs/adr/0022-notifications.md.
 */
export async function sendNotificationEmail(payload: NotificationEmailJobPayload): Promise<void> {
  const data = await withTenantTx(prisma, payload.tenantId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: payload.userId } });
    if (!user) return null;
    const channel = await tx.emailChannel.findFirst({ where: { isActive: true } });
    if (!channel) return null;
    return { user, channel };
  });
  if (!data) return;

  const transport = createTransportForChannel(data.channel);
  await transport.sendMail({
    from: data.channel.fromAddress,
    to: data.user.email,
    subject: payload.subject,
    text: payload.body,
  });
}
