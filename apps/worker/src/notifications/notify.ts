import { prisma, withTenantTx, type NotificationEventType } from '@seredina/db';
import { notificationEmailQueue } from '../lib/queue';

export interface NotifyInput {
  ticketId?: string;
  body: string;
  subject: string;
}

/**
 * The worker-side twin of apps/api/src/modules/notifications/service.ts's
 * notifyUser -- same preference-check-then-write-then-maybe-enqueue shape,
 * duplicated rather than shared because apps/worker never imports apps/api
 * code (see docs/adr/0020-oncall-escalation.md for the first time this
 * exact call was made, for the escalation engine). Only ever called for
 * NEW_REPLY, from the inbound-email ingest path -- see
 * docs/adr/0022-notifications.md.
 */
export async function notifyUser(tenantId: string, userId: string, eventType: NotificationEventType, input: NotifyInput) {
  const needsEmail = await withTenantTx(prisma, tenantId, async (tx) => {
    const pref = await tx.notificationPreference.findUnique({ where: { userId_eventType: { userId, eventType } } });
    const inApp = pref?.inApp ?? true;
    const email = pref?.email ?? false;
    if (inApp) {
      await tx.notification.create({ data: { tenantId, userId, eventType, ticketId: input.ticketId, body: input.body } });
    }
    return email;
  });

  if (needsEmail) {
    await notificationEmailQueue.add('send', { tenantId, userId, subject: input.subject, body: input.body });
  }
}
