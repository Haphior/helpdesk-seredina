import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TelegramApiError, type TelegramUpdate } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  connectTelegramChannel,
  disconnectTelegramChannel,
  getTelegramChannel,
  handleTelegramUpdate,
  resolveTenantIdByTelegramWebhook,
  verifyTelegramWebhookSecret,
} from './service';

const connectSchema = z.object({ botToken: z.string().min(1) });

export default async function telegramRoutes(app: FastifyInstance) {
  app.get(
    '/telegram-channel',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const channel = await getTelegramChannel(request.user.tenantId);
      return reply.send(channel);
    },
  );

  app.patch(
    '/telegram-channel',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const parsed = connectSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const channel = await connectTelegramChannel(request.user.tenantId, parsed.data.botToken);
        await auditRequest(request, 'telegram.connected', { type: 'telegram_channel', label: channel.botUsername });
        return reply.send(channel);
      } catch (err) {
        const message = err instanceof TelegramApiError ? `Telegram rejected this bot token: ${err.message}` : (err as Error).message;
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.delete(
    '/telegram-channel',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      await disconnectTelegramChannel(request.user.tenantId);
      await auditRequest(request, 'telegram.disconnected', { type: 'telegram_channel' });
      return reply.code(204).send();
    },
  );

  // Telegram itself calls this -- no login, no ApiKey (Telegram's webhook config
  // supports exactly one custom auth mechanism: the secret_token set at
  // setWebhook time, echoed back on every call via this header). webhookId in
  // the path routes the call to a tenant with no tenant context yet, same shape
  // as modules/kb's /public/:tenantSlug routes; the header is then checked
  // against that tenant's own stored secret. See docs/adr/0044-telegram-channel.md.
  app.post('/v1/integrations/telegram/webhook/:webhookId', async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const tenantId = await resolveTenantIdByTelegramWebhook(webhookId);
    if (!tenantId) return reply.code(404).send({ error: 'not found' });

    const secretHeader = request.headers['x-telegram-bot-api-secret-token'];
    const valid = await verifyTelegramWebhookSecret(tenantId, typeof secretHeader === 'string' ? secretHeader : undefined);
    if (!valid) return reply.code(401).send({ error: 'invalid secret token' });

    // Always 200 once authenticated -- Telegram retries on anything else, and a
    // malformed/unsupported update (see handleTelegramUpdate's own text-only
    // scope cut) is not a delivery failure worth retrying.
    await handleTelegramUpdate(tenantId, request.body as TelegramUpdate);
    return reply.code(200).send({ ok: true });
  });
}
