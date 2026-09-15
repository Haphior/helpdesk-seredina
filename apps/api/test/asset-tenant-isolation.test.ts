import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, uncheckedPrisma, withTenantTx } from '@seredina/db';

/**
 * Same proportional extension as test/ticket-tenant-isolation.test.ts, this time for
 * the CMDB/discovery tables added alongside agentless network discovery -- the
 * isolation mechanism itself is generic (TENANT_SCOPE_FIELD + the looped RLS policy
 * in prisma/rls/policies.sql), already proven for User/Ticket; this exists to catch
 * a typo'd table name or a forgotten TENANT_SCOPE_FIELD entry on these specific new
 * tables, not to re-prove the mechanism from scratch.
 */
const hasDb = Boolean(process.env.DATABASE_URL && process.env.TEST_ADMIN_DATABASE_URL);

describe.skipIf(!hasDb)('asset/discovery cross-tenant isolation', () => {
  let tenantAId: string;
  let tenantBId: string;
  let assetAId: string;
  let assetBId: string;
  let jobAId: string;

  async function createTenantWithAssetAndJob(label: string) {
    const tenantId = randomUUID();
    return withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `asset-${label}-${tenantId.slice(0, 8)}`, name: label } });
      const asset = await tx.asset.create({
        data: { tenantId, name: label, ipAddress: `10.0.${label === 'a' ? 1 : 2}.1`, assetType: 'OTHER' },
      });
      const job = await tx.discoveryJob.create({ data: { tenantId, cidrRange: '10.0.0.0/30' } });
      return { tenantId, assetId: asset.id, jobId: job.id };
    });
  }

  beforeAll(async () => {
    const a = await createTenantWithAssetAndJob('a');
    const b = await createTenantWithAssetAndJob('b');
    tenantAId = a.tenantId;
    assetAId = a.assetId;
    jobAId = a.jobId;
    tenantBId = b.tenantId;
    assetBId = b.assetId;
  });

  it('both layers active: tenant A cannot see tenant B assets or discovery jobs', async () => {
    await withTenantTx(prisma, tenantAId, async (tx) => {
      const assets = await tx.asset.findMany();
      expect(assets.map((a) => a.id)).toEqual([assetAId]);
      expect(await tx.asset.findUnique({ where: { id: assetBId } })).toBeNull();

      const jobs = await tx.discoveryJob.findMany();
      expect(jobs.map((j) => j.id)).toEqual([jobAId]);
    });
  });

  it('both layers active: RLS WITH CHECK rejects a forged cross-tenant asset write', async () => {
    await expect(
      withTenantTx(uncheckedPrisma, tenantAId, async (rawTx) =>
        // uncheckedPrisma has no extension to auto-fill tenantId -- forging it
        // directly is exactly the bug RLS's WITH CHECK exists to catch.
        rawTx.asset.create({
          data: { tenantId: tenantBId, name: 'forged', ipAddress: '10.0.9.9', assetType: 'OTHER' },
        }),
      ),
    ).rejects.toThrow();
  });
});
