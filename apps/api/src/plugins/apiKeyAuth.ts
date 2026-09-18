import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sha256Hex } from '@seredina/shared';
import { resolveTenantIdByApiKeyHash } from '@seredina/db';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyTenantId?: string;
  }
}

export default fp(async function apiKeyAuthPlugin(app: FastifyInstance) {
  app.decorate('authenticateApiKey', async function authenticateApiKey(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const header = request.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!key) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const tenantId = await resolveTenantIdByApiKeyHash(sha256Hex(key));
    if (!tenantId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    request.apiKeyTenantId = tenantId;
  });
});
