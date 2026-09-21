import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sha256Hex } from '@seredina/shared';
import { prisma } from '@seredina/db';

declare module 'fastify' {
  interface FastifyRequest {
    /** The check-in route re-resolves the tenant and Device row from this -- see modules/devices/service.ts's checkIn(). */
    deviceHashedCredential?: string;
  }
}

/** No tenant context yet -- see resolve_tenant_id_by_device_credential_hash in rls/policies.sql. Mirrors apiKeyAuth.ts exactly. */
async function resolveTenantIdByDeviceCredentialHash(hashedCredential: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_id_by_device_credential_hash(${hashedCredential}) AS tenant_id`;
  return rows[0]?.tenant_id ?? null;
}

export default fp(async function deviceAuthPlugin(app: FastifyInstance) {
  app.decorate('authenticateDevice', async function authenticateDevice(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;
    const credential = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!credential) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const hashedCredential = sha256Hex(credential);
    const tenantId = await resolveTenantIdByDeviceCredentialHash(hashedCredential);
    if (!tenantId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    request.deviceHashedCredential = hashedCredential;
  });
});
