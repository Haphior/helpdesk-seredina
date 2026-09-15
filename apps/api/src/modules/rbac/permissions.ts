import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '@seredina/shared';

export function requirePermission(permission: Permission) {
  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user?.permissions?.includes(permission)) {
      reply.code(403).send({ error: 'forbidden' });
    }
  };
}
