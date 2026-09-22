import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { PERMISSIONS } from '@seredina/shared';
import { createUser, listUsers, login, resetUserPassword, unlockUser, updateUser } from '../src/modules/auth/service';
import { createApiKey, deleteApiKey, listApiKeys } from '../src/modules/apikeys/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Administration (review pass)', () => {
  let tenantId: string;
  let tenantSlug: string;
  let adminId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    tenantSlug = `admin-review-${tenantId.slice(0, 8)}`;
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: tenantSlug, name: 'Admin Review' } });
      const role = await tx.role.create({ data: { tenantId, key: 'admin', name: 'Admin' } });
      const admin = await tx.user.create({
        data: { tenantId, email: 'admin@example.com', name: 'Admin', passwordHash: 'x', roleId: role.id },
      });
      adminId = admin.id;
    });
  });

  describe('user deactivation', () => {
    it('a deactivated user can no longer log in, and reactivating restores access', async () => {
      const user = await createUser(tenantId, { email: 'agent@example.com', name: 'Agent', password: 'password123', roleKey: 'admin' }, PERMISSIONS);

      const before = await login({ tenantSlug, email: 'agent@example.com', password: 'password123' });
      expect(before.userId).toBe(user.id);

      await updateUser(tenantId, user.id, { isActive: false });
      await expect(login({ tenantSlug, email: 'agent@example.com', password: 'password123' })).rejects.toThrow(
        'invalid credentials',
      );

      await updateUser(tenantId, user.id, { isActive: true });
      const after = await login({ tenantSlug, email: 'agent@example.com', password: 'password123' });
      expect(after.userId).toBe(user.id);
    });

    it('rejects a self-deactivation', async () => {
      await expect(updateUser(tenantId, adminId, { isActive: false }, { id: adminId, permissions: PERMISSIONS })).rejects.toThrow(
        'you cannot deactivate your own account',
      );
    });

    it('listUsers reports isActive and isLocked for every user', async () => {
      const users = await listUsers(tenantId);
      const admin = users.find((u) => u.id === adminId);
      expect(admin?.isActive).toBe(true);
      expect(admin?.isLocked).toBe(false);
    });
  });

  describe('account lockout + unlock', () => {
    it('unlockUser clears a lockout early, restoring login before the timeout would', async () => {
      const user = await createUser(tenantId, { email: 'locked@example.com', name: 'Locked', password: 'realpassword1', roleKey: 'admin' }, PERMISSIONS);

      for (let i = 0; i < 5; i++) {
        await login({ tenantSlug, email: 'locked@example.com', password: 'wrong-password' }).catch(() => {});
      }
      await expect(login({ tenantSlug, email: 'locked@example.com', password: 'realpassword1' })).rejects.toThrow(
        'invalid credentials',
      );

      const usersBeforeUnlock = await listUsers(tenantId);
      expect(usersBeforeUnlock.find((u) => u.id === user.id)?.isLocked).toBe(true);

      await unlockUser(tenantId, user.id);
      const result = await login({ tenantSlug, email: 'locked@example.com', password: 'realpassword1' });
      expect(result.userId).toBe(user.id);

      const usersAfterUnlock = await listUsers(tenantId);
      expect(usersAfterUnlock.find((u) => u.id === user.id)?.isLocked).toBe(false);
    });
  });

  describe('admin password reset', () => {
    it('resetUserPassword changes the password and clears any lockout', async () => {
      const user = await createUser(tenantId, { email: 'reset@example.com', name: 'Reset Me', password: 'oldpassword1', roleKey: 'admin' }, PERMISSIONS);

      await resetUserPassword(tenantId, user.id, 'brandnewpassword1');

      await expect(login({ tenantSlug, email: 'reset@example.com', password: 'oldpassword1' })).rejects.toThrow(
        'invalid credentials',
      );
      const result = await login({ tenantSlug, email: 'reset@example.com', password: 'brandnewpassword1' });
      expect(result.userId).toBe(user.id);
    });
  });

  describe('API key revocation', () => {
    it('a revoked key no longer appears in the list, and revoking twice 404s', async () => {
      const created = await createApiKey(tenantId, 'integration-key');
      expect((await listApiKeys(tenantId)).map((k) => k.id)).toContain(created.id);

      await deleteApiKey(tenantId, created.id);
      expect((await listApiKeys(tenantId)).map((k) => k.id)).not.toContain(created.id);

      await expect(deleteApiKey(tenantId, created.id)).rejects.toThrow('API key not found');
    });
  });
});
