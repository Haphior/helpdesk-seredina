import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createAsset, getAsset, linkAssetToTicket, listAssets } from '../src/modules/assets/service';
import { createService, linkAssetToService } from '../src/modules/services/service';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Assets (CMDB review pass)', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `assets-${tenantId.slice(0, 8)}`, name: 'Assets Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  describe('search + filter + pagination', () => {
    it('q matches name, IP, or hostname, case-insensitively', async () => {
      await createAsset(tenantId, { name: 'mail-server-1', assetType: 'SERVER', ipAddress: '10.0.5.20', hostname: 'mail1.internal' });
      await createAsset(tenantId, { name: 'unrelated-printer', assetType: 'PRINTER' });

      const byName = await listAssets(tenantId, { q: 'MAIL-SERVER' });
      expect(byName.assets.some((a) => a.name === 'mail-server-1')).toBe(true);
      expect(byName.assets.some((a) => a.name === 'unrelated-printer')).toBe(false);

      const byIp = await listAssets(tenantId, { q: '10.0.5.20' });
      expect(byIp.assets.some((a) => a.name === 'mail-server-1')).toBe(true);

      const byHostname = await listAssets(tenantId, { q: 'mail1.internal' });
      expect(byHostname.assets.some((a) => a.name === 'mail-server-1')).toBe(true);
    });

    it('filters by assetType and status', async () => {
      await createAsset(tenantId, { name: 'retired-workstation', assetType: 'WORKSTATION', status: 'RETIRED' });

      const workstationsOnly = await listAssets(tenantId, { assetType: 'WORKSTATION' });
      expect(workstationsOnly.assets.every((a) => a.assetType === 'WORKSTATION')).toBe(true);

      const retiredOnly = await listAssets(tenantId, { status: 'RETIRED' });
      expect(retiredOnly.assets.some((a) => a.name === 'retired-workstation')).toBe(true);
      expect(retiredOnly.assets.every((a) => a.status === 'RETIRED')).toBe(true);
    });

    it('limit/offset page correctly and total reflects the full count', async () => {
      const freshTenantId = randomUUID();
      await withTenantTx(prisma, freshTenantId, (tx) =>
        tx.tenant.create({ data: { id: freshTenantId, slug: `assets-page-${freshTenantId.slice(0, 8)}`, name: 'Paging' } }),
      );
      for (let i = 0; i < 5; i++) {
        await createAsset(freshTenantId, { name: `asset-${i}`, assetType: 'OTHER' });
      }
      const page1 = await listAssets(freshTenantId, { limit: 2, offset: 0 });
      const page2 = await listAssets(freshTenantId, { limit: 2, offset: 2 });
      expect(page1.assets).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page2.total).toBe(5);
      expect(page1.assets.map((a) => a.id)).not.toEqual(page2.assets.map((a) => a.id));
    });
  });

  describe('getAsset enrichment', () => {
    it('returns linked tickets and the services this asset underpins', async () => {
      const asset = await createAsset(tenantId, { name: 'db-server-2', assetType: 'SERVER' });
      const service = await createService(tenantId, { name: 'Payroll' });
      await linkAssetToService(tenantId, service.id, asset.id);

      const ticket = await createTicketFromApi(tenantId, {
        subject: 'DB is slow',
        body: 'b',
        contactEmail: 'c@example.com',
        contactName: 'C',
      });
      await linkAssetToTicket(tenantId, ticket.id, asset.id);

      const fetched = await getAsset(tenantId, asset.id);
      expect(fetched.services).toEqual([{ id: service.id, name: 'Payroll' }]);
      expect(fetched.tickets.map((t) => t.ticket.id)).toEqual([ticket.id]);
    });

    it('an asset with no links reports empty arrays, not an error', async () => {
      const asset = await createAsset(tenantId, { name: 'unlinked-printer', assetType: 'PRINTER' });
      const fetched = await getAsset(tenantId, asset.id);
      expect(fetched.services).toEqual([]);
      expect(fetched.tickets).toEqual([]);
    });
  });
});
