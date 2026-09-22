import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { PERMISSIONS } from '@seredina/shared';
import jwtPlugin from '../src/plugins/jwt';
import { requirePermission } from '../src/modules/rbac/permissions';
import { createRole, createUser, updateRole, updateUser } from '../src/modules/auth/service';

const hasDb = Boolean(process.env.DATABASE_URL);

/**
 * The JWT plugin's authenticate() must not trust a token's baked-in
 * permissions or outlive the user it was issued to -- see plugins/jwt.ts.
 */
describe.skipIf(!hasDb)('JWT sessions', () => {
  let app: FastifyInstance;
  let tenantId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-jwt-secret';
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `jwt-session-${tenantId.slice(0, 8)}`, name: 'JWT Session' } }),
    );
    await createRole(tenantId, { key: 'manager', name: 'Manager', permissions: ['tickets:read', 'users:manage'] });

    app = Fastify();
    await app.register(jwtPlugin);
    app.get('/whoami', { preHandler: app.authenticate }, async (request) => ({ permissions: request.user.permissions }));
    app.get('/admin-only', { preHandler: [app.authenticate, requirePermission('users:manage')] }, async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function tokenFor(roleKey: string) {
    const user = await createUser(
      tenantId,
      { email: `${randomUUID()}@example.com`, name: 'User', password: 'password123', roleKey },
      PERMISSIONS,
    );
    // Deliberately claims every permission -- authenticate() must ignore this.
    const token = app.jwt.sign({ sub: user.id, tenantId, permissions: [...PERMISSIONS] });
    return { userId: user.id, auth: { authorization: `Bearer ${token}` } };
  }

  it('signs tokens with an expiry', async () => {
    const { auth } = await tokenFor('manager');
    const decoded = app.jwt.decode<{ exp?: number }>(auth.authorization.slice('Bearer '.length));
    expect(decoded?.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it("uses the user's current DB permissions, not the ones in the token", async () => {
    const { auth } = await tokenFor('manager');
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().permissions.sort()).toEqual(['tickets:read', 'users:manage']);
  });

  it('revokes access immediately when the user is deactivated', async () => {
    const { userId, auth } = await tokenFor('manager');
    expect((await app.inject({ method: 'GET', url: '/whoami', headers: auth })).statusCode).toBe(200);

    await updateUser(tenantId, userId, { isActive: false });
    expect((await app.inject({ method: 'GET', url: '/whoami', headers: auth })).statusCode).toBe(401);
  });

  it("a permission removed from the user's role stops working immediately", async () => {
    await createRole(tenantId, { key: 'shrinking', name: 'Shrinking', permissions: ['tickets:read', 'users:manage'] });
    const { auth } = await tokenFor('shrinking');
    expect((await app.inject({ method: 'GET', url: '/admin-only', headers: auth })).statusCode).toBe(200);

    const role = await withTenantTx(prisma, tenantId, (tx) =>
      tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'shrinking' } } }),
    );
    await updateRole(tenantId, role.id, { permissions: ['tickets:read'] });
    expect((await app.inject({ method: 'GET', url: '/admin-only', headers: auth })).statusCode).toBe(403);
  });

  it('rejects a token for a user that does not exist', async () => {
    const token = app.jwt.sign({ sub: randomUUID(), tenantId, permissions: [...PERMISSIONS] });
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { userId } = await tokenFor('manager');
    const expired = app.jwt.sign({ sub: userId, tenantId, permissions: [] }, { expiresIn: -10 });
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${expired}` } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a legacy token issued without an expiry', async () => {
    const { userId } = await tokenFor('manager');
    const legacy = app.jwt.sign({ sub: userId, tenantId, permissions: [] }, { expiresIn: undefined });
    const decoded = app.jwt.decode<{ exp?: number }>(legacy);
    // Guard: make sure this test really exercises a token WITHOUT exp.
    if (decoded?.exp !== undefined) throw new Error('test setup: token unexpectedly has exp');
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${legacy}` } });
    expect(res.statusCode).toBe(401);
  });
});
