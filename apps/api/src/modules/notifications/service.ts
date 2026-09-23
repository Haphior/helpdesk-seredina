import { prisma, withTenantTx, type NotificationEventType } from '@seredina/db';
import { publishLive } from '../../lib/live';
import { notificationEmailQueue } from '../../lib/queue';

const EVENT_LABELS: Record<NotificationEventType, string> = {
  TICKET_ASSIGNED: 'A ticket is assigned to me',
  NEW_REPLY: 'A contact replies to a ticket assigned to me',
  CONTRACT_EXPIRING: 'A contract, warranty or license is about to expire (users who manage assets)',
};

const EVENT_TYPES: NotificationEventType[] = ['TICKET_ASSIGNED', 'NEW_REPLY', 'CONTRACT_EXPIRING'];

export async function listNotifications(tenantId: string, userId: string, unreadOnly = false) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.notification.findMany({
      where: { userId, readAt: unreadOnly ? null : undefined },
      include: { ticket: { select: { id: true, number: true, subject: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  );
}

export async function getUnreadCount(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.notification.count({ where: { userId, readAt: null } }));
}

export async function markNotificationRead(tenantId: string, userId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new Error('notification not found');
    return tx.notification.update({ where: { id }, data: { readAt: new Date() } });
  });
}

export async function markAllNotificationsRead(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }),
  );
}

/** Merges stored overrides with the "no row = inApp:true, email:false" default -- see schema comment on NotificationPreference. */
export async function getPreferences(tenantId: string, userId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const rows = await tx.notificationPreference.findMany({ where: { userId } });
    const byType = new Map(rows.map((r) => [r.eventType, r]));
    return EVENT_TYPES.map((eventType) => {
      const row = byType.get(eventType);
      return { eventType, label: EVENT_LABELS[eventType], inApp: row?.inApp ?? true, email: row?.email ?? false };
    });
  });
}

export interface UpdatePreferenceInput {
  inApp?: boolean;
  email?: boolean;
}

export async function updatePreference(
  tenantId: string,
  userId: string,
  eventType: NotificationEventType,
  input: UpdatePreferenceInput,
) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.notificationPreference.upsert({
      where: { userId_eventType: { userId, eventType } },
      create: { tenantId, userId, eventType, inApp: input.inApp ?? true, email: input.email ?? false },
      update: input,
    }),
  );
}

export interface NotifyInput {
  ticketId?: string;
  /** Shown in-app. */
  body: string;
  /** Only used if the preference calls for email too. */
  subject: string;
}

/**
 * The one "tell a user something happened" entry point on the apps/api side --
 * writes the in-app Notification row (if the recipient's preference allows it)
 * inside its own short transaction, then enqueues the email delivery job
 * OUTSIDE any transaction if the preference also calls for email (network I/O
 * never belongs inside withTenantTx). apps/worker has its own, near-identical
 * copy of this function (modules/notifications/notify.ts there) for the
 * NEW_REPLY event, which only ever fires from the worker's own inbound-email
 * ingest -- see docs/adr/0022-notifications.md for why that isn't shared code.
 */
export async function notifyUser(tenantId: string, userId: string, eventType: NotificationEventType, input: NotifyInput) {
  const { inApp, needsEmail } = await withTenantTx(prisma, tenantId, async (tx) => {
    const pref = await tx.notificationPreference.findUnique({ where: { userId_eventType: { userId, eventType } } });
    const inApp = pref?.inApp ?? true;
    if (inApp) {
      await tx.notification.create({ data: { tenantId, userId, eventType, ticketId: input.ticketId, body: input.body } });
    }
    return { inApp, needsEmail: pref?.email ?? false };
  });

  if (inApp) await publishLive(tenantId, { type: 'notification.created', userId });

  if (needsEmail) {
    await notificationEmailQueue.add('send', { tenantId, userId, subject: input.subject, body: input.body });
  }
}
