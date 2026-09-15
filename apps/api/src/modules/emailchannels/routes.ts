import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { createEmailChannel, deleteEmailChannel, listEmailChannels } from './service';

const emailChannelSchema = z.object({
  name: z.string().min(1).max(100),
  fromAddress: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapSecure: z.boolean().default(true),
  imapUsername: z.string().min(1),
  imapPassword: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean().default(true),
  smtpUsername: z.string().min(1),
  smtpPassword: z.string().min(1),
});

export default async function emailChannelRoutes(app: FastifyInstance) {
  app.get(
    '/email-channels',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const emailChannels = await listEmailChannels(request.user.tenantId);
      return reply.send({ emailChannels });
    },
  );

  app.post(
    '/email-channels',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const parsed = emailChannelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const channel = await createEmailChannel(request.user.tenantId, parsed.data);
      return reply.code(201).send(channel);
    },
  );

  app.delete(
    '/email-channels/:id',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteEmailChannel(request.user.tenantId, id);
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'email channel not found' });
      }
    },
  );
}
