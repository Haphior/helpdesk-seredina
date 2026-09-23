import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidMicrosoftTenant } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import {
  completeEmailOAuth,
  createEmailChannel,
  createOAuthEmailChannel,
  deleteEmailChannel,
  emailChannelsConsoleUrl,
  emailOAuthRedirectUri,
  EmailOAuthSetupError,
  listEmailChannels,
  startEmailOAuth,
} from './service';
import { auditRequest, recordAudit, requestOrigin } from '../audit/service';

const passwordChannelSchema = z.object({
  authType: z.literal('password').default('password'),
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

const oauthChannelSchema = z.object({
  authType: z.enum(['google_oauth', 'microsoft_oauth']),
  name: z.string().min(1).max(100),
  fromAddress: z.string().email(),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(2000),
  microsoftTenant: z
    .string()
    .max(253)
    .refine((v) => v === '' || isValidMicrosoftTenant(v), 'must be a directory (tenant) ID, a domain, or "organizations"')
    .nullish(),
});

export default async function emailChannelRoutes(app: FastifyInstance) {
  app.get(
    '/email-channels',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const emailChannels = await listEmailChannels(request.user.tenantId);
      // The redirect URI the admin must register in their Google/Microsoft app.
      return reply.send({ emailChannels, oauthRedirectUri: emailOAuthRedirectUri() });
    },
  );

  app.post(
    '/email-channels',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const authType = (request.body as { authType?: unknown } | null)?.authType;
      if (authType === 'google_oauth' || authType === 'microsoft_oauth') {
        const parsed = oauthChannelSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
        const channel = await createOAuthEmailChannel(request.user.tenantId, parsed.data);
        await auditRequest(request, 'email_channel.created', { type: 'email_channel', id: channel.id, label: channel.fromAddress }, { authType: channel.authType });
        return reply.code(201).send(channel);
      }

      const parsed = passwordChannelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const channel = await createEmailChannel(request.user.tenantId, parsed.data);
      await auditRequest(request, 'email_channel.created', { type: 'email_channel', id: channel.id, label: channel.fromAddress }, { authType: 'password' });
      return reply.code(201).send(channel);
    },
  );

  // Starts (or restarts, for a needs_reconnect channel) the consent flow; the
  // console then navigates to the returned URL.
  app.post(
    '/email-channels/:id/oauth/authorize',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const authorizeUrl = await startEmailOAuth(request.user.tenantId, id, request.user.sub);
        return reply.send({ authorizeUrl });
      } catch (err) {
        if (err instanceof EmailOAuthSetupError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  // Google/Microsoft redirect the admin's browser here -- no session header on
  // a top-level redirect, so the signed `state` carries the tenant and channel.
  // Always answers with a redirect back to the console, never a JSON error page.
  app.get(
    '/email-channels/oauth/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const q = request.query as { code?: string; state?: string; error?: string; error_description?: string };
      if (q.error) {
        return reply.redirect(emailChannelsConsoleUrl({ error: q.error_description || q.error }));
      }
      if (!q.code || !q.state) {
        return reply.redirect(emailChannelsConsoleUrl({ error: 'missing code or state' }));
      }
      try {
        const connected = await completeEmailOAuth(q.state, q.code);
        await recordAudit(connected.tenantId, {
          action: 'email_channel.connected',
          actorType: connected.userId ? 'user' : 'anonymous',
          actorUserId: connected.userId,
          target: { type: 'email_channel', id: connected.channelId, label: connected.fromAddress },
          ...requestOrigin(request),
        });
        return reply.redirect(emailChannelsConsoleUrl({ connected: true }));
      } catch (err) {
        request.log.warn({ err }, 'email OAuth callback failed');
        const message = err instanceof Error ? err.message : 'authorization failed';
        return reply.redirect(emailChannelsConsoleUrl({ error: message.slice(0, 300) }));
      }
    },
  );

  app.delete(
    '/email-channels/:id',
    { preHandler: [app.authenticate, requirePermission('channels:manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await deleteEmailChannel(request.user.tenantId, id);
        await auditRequest(request, 'email_channel.deleted', { type: 'email_channel', id });
        return reply.code(204).send();
      } catch {
        return reply.code(404).send({ error: 'email channel not found' });
      }
    },
  );
}
