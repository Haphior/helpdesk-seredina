import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import {
  getPreferences,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updatePreference,
} from './service';

const EVENT_TYPE = z.enum(['TICKET_ASSIGNED', 'NEW_REPLY']);
const updatePreferenceSchema = z.object({ inApp: z.boolean().optional(), email: z.boolean().optional() });

// A personal inbox and personal settings -- tickets:read, the same tier
// saved views and dashboard-widget preferences use, not tickets:manage_all.
export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: [app.authenticate, requirePermission('tickets:read')] }, async (request, reply) => {
    const { unread } = request.query as { unread?: string };
    const notifications = await listNotifications(request.user.tenantId, request.user.sub, unread === 'true');
    return reply.send({ notifications });
  });

  app.get(
    '/notifications/unread-count',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const count = await getUnreadCount(request.user.tenantId, request.user.sub);
      return reply.send({ count });
    },
  );

  app.post(
    '/notifications/:id/read',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const notification = await markNotificationRead(request.user.tenantId, request.user.sub, id);
        return reply.send(notification);
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    },
  );

  app.post(
    '/notifications/read-all',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      await markAllNotificationsRead(request.user.tenantId, request.user.sub);
      return reply.code(204).send();
    },
  );

  app.get(
    '/notification-preferences',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const preferences = await getPreferences(request.user.tenantId, request.user.sub);
      return reply.send({ preferences });
    },
  );

  app.put(
    '/notification-preferences/:eventType',
    { preHandler: [app.authenticate, requirePermission('tickets:read')] },
    async (request, reply) => {
      const eventTypeParsed = EVENT_TYPE.safeParse((request.params as { eventType: string }).eventType);
      const bodyParsed = updatePreferenceSchema.safeParse(request.body);
      if (!eventTypeParsed.success || !bodyParsed.success) {
        return reply.code(400).send({ error: 'invalid event type or body' });
      }
      const preference = await updatePreference(request.user.tenantId, request.user.sub, eventTypeParsed.data, bodyParsed.data);
      return reply.send(preference);
    },
  );
}
