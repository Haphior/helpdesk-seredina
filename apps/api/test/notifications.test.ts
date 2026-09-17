import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  getPreferences,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyUser,
  updatePreference,
} from '../src/modules/notifications/service';
import { createTicketFromApi, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Notifications', () => {
  let tenantId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `notif-${tenantId.slice(0, 8)}`, name: 'Notifications Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      const a = await tx.user.create({ data: { tenantId, email: 'notif-a@example.com', name: 'Notif A', passwordHash: 'x' } });
      const b = await tx.user.create({ data: { tenantId, email: 'notif-b@example.com', name: 'Notif B', passwordHash: 'x' } });
      userAId = a.id;
      userBId = b.id;
    });
  });

  it('a user with no preference row gets the default: inApp on, email off', async () => {
    const prefs = await getPreferences(tenantId, userAId);
    expect(prefs).toEqual([
      { eventType: 'TICKET_ASSIGNED', label: expect.any(String), inApp: true, email: false },
      { eventType: 'NEW_REPLY', label: expect.any(String), inApp: true, email: false },
    ]);
  });

  it('notifyUser writes an in-app row when inApp is on (the default)', async () => {
    await notifyUser(tenantId, userAId, 'TICKET_ASSIGNED', { body: 'You got a ticket', subject: 'Assigned' });
    const notifications = await listNotifications(tenantId, userAId);
    expect(notifications.some((n) => n.body === 'You got a ticket')).toBe(true);
    expect(await getUnreadCount(tenantId, userAId)).toBeGreaterThan(0);
  });

  it('turning inApp off for an event type stops new notifications of that type from being written', async () => {
    await updatePreference(tenantId, userBId, 'NEW_REPLY', { inApp: false });
    await notifyUser(tenantId, userBId, 'NEW_REPLY', { body: 'A reply landed', subject: 'New reply' });
    const notifications = await listNotifications(tenantId, userBId);
    expect(notifications.some((n) => n.body === 'A reply landed')).toBe(false);

    // A different event type for the same user is unaffected -- preferences are per (user, eventType).
    await notifyUser(tenantId, userBId, 'TICKET_ASSIGNED', { body: 'Different event', subject: 'Assigned' });
    const afterSecond = await listNotifications(tenantId, userBId);
    expect(afterSecond.some((n) => n.body === 'Different event')).toBe(true);
  });

  it('notifications are scoped per user -- one user never sees another\'s', async () => {
    const notificationsA = await listNotifications(tenantId, userAId);
    const notificationsB = await listNotifications(tenantId, userBId);
    const idsA = new Set(notificationsA.map((n) => n.id));
    expect(notificationsB.every((n) => !idsA.has(n.id))).toBe(true);
  });

  it('marking one notification read only affects that one; markAll clears every unread for that user', async () => {
    await notifyUser(tenantId, userAId, 'TICKET_ASSIGNED', { body: 'First', subject: 'x' });
    await notifyUser(tenantId, userAId, 'TICKET_ASSIGNED', { body: 'Second', subject: 'x' });
    const before = await listNotifications(tenantId, userAId, true);
    expect(before.length).toBeGreaterThanOrEqual(2);

    const [first] = before;
    await markNotificationRead(tenantId, userAId, first.id);
    const afterOne = await listNotifications(tenantId, userAId, true);
    expect(afterOne.some((n) => n.id === first.id)).toBe(false);
    expect(afterOne.length).toBe(before.length - 1);

    await markAllNotificationsRead(tenantId, userAId);
    expect(await getUnreadCount(tenantId, userAId)).toBe(0);
  });

  it('marking another user\'s notification read is rejected as not found', async () => {
    await notifyUser(tenantId, userBId, 'TICKET_ASSIGNED', { body: 'Belongs to B', subject: 'x' });
    const [notif] = await listNotifications(tenantId, userBId, true);
    await expect(markNotificationRead(tenantId, userAId, notif.id)).rejects.toThrow('notification not found');
  });

  it('assigning a ticket to a new user notifies them; re-saving the same assignee or clearing it does not', async () => {
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Needs an owner',
      body: 'body',
      contactEmail: 'c@example.com',
      contactName: 'C',
    });

    const beforeCount = await getUnreadCount(tenantId, userAId);
    await updateTicket(tenantId, ticket.id, { assigneeId: userAId });
    const afterAssign = await getUnreadCount(tenantId, userAId);
    expect(afterAssign).toBe(beforeCount + 1);

    // Re-saving the same assignee is not a new assignment -- no new notification.
    await updateTicket(tenantId, ticket.id, { assigneeId: userAId });
    expect(await getUnreadCount(tenantId, userAId)).toBe(afterAssign);

    // Clearing the assignee notifies no one (there's no one to notify).
    const beforeCountB = await getUnreadCount(tenantId, userBId);
    await updateTicket(tenantId, ticket.id, { assigneeId: null });
    expect(await getUnreadCount(tenantId, userBId)).toBe(beforeCountB);
  });

  it('reassigning to a different user notifies the new assignee, not the old one', async () => {
    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Gets reassigned',
      body: 'body',
      contactEmail: 'c@example.com',
      contactName: 'C',
    });
    await updateTicket(tenantId, ticket.id, { assigneeId: userAId });
    const beforeB = await getUnreadCount(tenantId, userBId);

    await updateTicket(tenantId, ticket.id, { assigneeId: userBId });
    expect(await getUnreadCount(tenantId, userBId)).toBe(beforeB + 1);
  });
});
