import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, uncheckedPrisma, withTenantTx, PrismaClient } from '@seredina/db';

/**
 * The mandatory Phase 0 test (see docs/adr/0001-multi-tenancy-rls.md): proves cross
 * tenant isolation holds, and specifically that it holds via TWO INDEPENDENT layers,
 * not one layer coincidentally covering for a broken other. Requires a live Postgres
 * with migrations + prisma/rls/policies.sql already applied (`docker compose up
 * postgres redis migrate`) and DATABASE_URL/TEST_ADMIN_DATABASE_URL pointing at it --
 * skipped entirely otherwise so `npm test` stays green with no DB available.
 *
 * TEST_ADMIN_DATABASE_URL must authenticate as the table-owning role (app_migrator)
 * since toggling RLS with ALTER TABLE requires ownership.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.TEST_ADMIN_DATABASE_URL);

describe.skipIf(!hasDb)('cross-tenant isolation', () => {
  // Constructed in beforeAll, not here -- describe.skipIf still evaluates the
  // describe body to collect its structure even when the suite is skipped, so a
  // PrismaClient() built here from an unset TEST_ADMIN_DATABASE_URL would throw and
  // fail the "no DB available" case this skip exists to keep green.
  let adminPrisma: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;

  async function createTenantWithUser(label: string) {
    const tenantId = randomUUID();
    return withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `iso-${label}-${tenantId.slice(0, 8)}`, name: label } });
      const user = await tx.user.create({
        data: { tenantId, email: `${label}@example.com`, name: label, passwordHash: 'x' },
      });
      return { tenantId, userId: user.id };
    });
  }

  async function setRls(enabled: boolean) {
    const action = enabled ? 'ENABLE' : 'DISABLE';
    await adminPrisma.$executeRawUnsafe(`ALTER TABLE users ${action} ROW LEVEL SECURITY`);
  }

  beforeAll(async () => {
    adminPrisma = new PrismaClient({
      datasources: { db: { url: process.env.TEST_ADMIN_DATABASE_URL } },
    });
    const a = await createTenantWithUser('tenant-a');
    const b = await createTenantWithUser('tenant-b');
    tenantAId = a.tenantId;
    userAId = a.userId;
    tenantBId = b.tenantId;
    userBId = b.userId;
  });

  afterAll(async () => {
    await setRls(true); // always leave RLS enabled, even if a test above failed
    await adminPrisma.$disconnect();
    await uncheckedPrisma.$disconnect();
    await prisma.$disconnect();
  });

  it('both layers active: tenant A cannot see tenant B via the normal guarded client', async () => {
    await withTenantTx(prisma, tenantAId, async (tx) => {
      const users = await tx.user.findMany();
      expect(users.map((u) => u.id)).toEqual([userAId]);

      const crossTenantRead = await tx.user.findUnique({ where: { id: userBId } });
      expect(crossTenantRead).toBeNull();
    });
  });

  it('both layers active: RLS WITH CHECK rejects a write the extension mis-scoped', async () => {
    // Simulates a bug in the extension itself by forging tenantId in the raw
    // write via uncheckedPrisma while the tenant-context session var is A -- RLS's
    // WITH CHECK must still reject a row that claims to belong to tenant B.
    await expect(
      withTenantTx(uncheckedPrisma, tenantAId, async (tx) =>
        // uncheckedPrisma has no extension to auto-fill tenantId, so this is a
        // direct, deliberately-forged cross-tenant write -- exactly the bug RLS's
        // WITH CHECK exists to catch even when application code gets it wrong.
        tx.user.create({
          data: { tenantId: tenantBId, email: 'forged@example.com', name: 'forged', passwordHash: 'x' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('RLS disabled: the Prisma extension alone still blocks cross-tenant access', async () => {
    await setRls(false);
    try {
      await withTenantTx(prisma, tenantAId, async (tx) => {
        const users = await tx.user.findMany();
        expect(users.map((u) => u.id)).toEqual([userAId]);

        const crossTenantRead = await tx.user.findUnique({ where: { id: userBId } });
        expect(crossTenantRead).toBeNull();
      });
    } finally {
      await setRls(true);
    }
  });

  it('extension bypassed (raw client): RLS alone still blocks cross-tenant access', async () => {
    await withTenantTx(uncheckedPrisma, tenantAId, async (tx) => {
      // uncheckedPrisma has no extension, so this is a genuinely unfiltered
      // `SELECT * FROM users` at the Prisma level -- RLS is the only thing left.
      const users = await tx.user.findMany();
      expect(users.map((u) => u.id)).toEqual([userAId]);
    });
  });

  it('positive control: with BOTH layers off, the leak this design prevents is real', async () => {
    await setRls(false);
    try {
      await withTenantTx(uncheckedPrisma, tenantAId, async (tx) => {
        const users = await tx.user.findMany();
        const ids = users.map((u) => u.id);
        expect(ids).toContain(userAId);
        expect(ids).toContain(userBId); // the leak -- proves the mitigations above are load-bearing
      });
    } finally {
      await setRls(true);
    }
  });
});
