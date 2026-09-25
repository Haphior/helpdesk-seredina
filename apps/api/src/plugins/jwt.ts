import jwt from '@fastify/jwt';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getActiveUserPermissions } from '../modules/auth/service';

// Short enough that a leaked token stops working on its own within a working
// day; long enough that nobody gets bounced to /login mid-shift. There's no
// refresh-token flow yet, so this IS the session length.
const DEFAULT_JWT_EXPIRES_IN = '8h';

export default fp(async function jwtPlugin(app: FastifyInstance) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env var is required');
  }

  app.register(jwt, {
    secret,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES_IN },
    // Tokens issued before expiry existed carry no `exp` and would otherwise
    // stay valid forever -- requiring the claim retires them.
    verify: { requiredClaims: ['exp'] },
  });

  // A valid signature alone isn't enough: the token's `permissions` are a
  // snapshot from login time. Re-read the user on every request so that
  // deactivating a user, deleting them, or changing their role (or the role's
  // permissions) takes effect immediately instead of whenever the token expires.
  // requirePermission() then checks these fresh permissions, never the token's.
  app.decorate('authenticate', async function authenticate(request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const issuedAt = (request.user as { iat?: number }).iat;
    const permissions = await getActiveUserPermissions(request.user.tenantId, request.user.sub, issuedAt);
    if (!permissions) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.user.permissions = permissions;
  });
});
