import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createAsset } from '../src/modules/assets/service';
import { createService, deleteService, linkAssetToService, listServices, unlinkAssetFromService } from '../src/modules/services/service';
import { createTicketFromApi, seedDefaultTicketStatuses, getTicket } from '../src/modules/tickets/service';
import { linkAssetToTicket } from '../src/modules/assets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Service Configuration Management', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `svccfg-${tenantId.slice(0, 8)}`, name: 'Service Config Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('creates a service and rejects a duplicate name', async () => {
    const service = await createService(tenantId, { name: 'Payroll', description: 'The payroll processing service.' });
    expect(service.assets).toEqual([]);

    await expect(createService(tenantId, { name: 'Payroll' })).rejects.toThrow('a service with this name already exists');
  });

  it('links two assets to a service, and lists them back on the service', async () => {
    const service = await createService(tenantId, { name: 'Email' });
    const mailServer = await createAsset(tenantId, { name: 'mail01', assetType: 'SERVER' });
    const dnsServer = await createAsset(tenantId, { name: 'dns01', assetType: 'SERVER' });

    await linkAssetToService(tenantId, service.id, mailServer.id);
    const withBoth = await linkAssetToService(tenantId, service.id, dnsServer.id);

    expect(withBoth.assets.map((a) => a.asset.name).sort()).toEqual(['dns01', 'mail01']);
  });

  it('one asset can underpin more than one service', async () => {
    const sharedDb = await createAsset(tenantId, { name: 'shared-db01', assetType: 'SERVER' });
    const serviceA = await createService(tenantId, { name: 'CRM' });
    const serviceB = await createService(tenantId, { name: 'Billing' });

    await linkAssetToService(tenantId, serviceA.id, sharedDb.id);
    await linkAssetToService(tenantId, serviceB.id, sharedDb.id);

    const services = await listServices(tenantId);
    const namesUnderpinnedBySharedDb = services
      .filter((s) => s.assets.some((a) => a.asset.id === sharedDb.id))
      .map((s) => s.name)
      .sort();
    expect(namesUnderpinnedBySharedDb).toEqual(['Billing', 'CRM']);
  });

  it('unlinking an asset removes it from the service, without deleting the asset or the service', async () => {
    const service = await createService(tenantId, { name: 'VPN' });
    const gateway = await createAsset(tenantId, { name: 'vpn-gw01', assetType: 'NETWORK_DEVICE' });
    await linkAssetToService(tenantId, service.id, gateway.id);

    await unlinkAssetFromService(tenantId, service.id, gateway.id);

    const services = await listServices(tenantId);
    const vpn = services.find((s) => s.id === service.id);
    expect(vpn?.assets).toEqual([]);
  });

  it('rejects linking a nonexistent asset or service', async () => {
    const service = await createService(tenantId, { name: 'Intranet' });
    const asset = await createAsset(tenantId, { name: 'web01', assetType: 'SERVER' });

    await expect(linkAssetToService(tenantId, service.id, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'asset not found',
    );
    await expect(linkAssetToService(tenantId, '00000000-0000-0000-0000-000000000000', asset.id)).rejects.toThrow(
      'service not found',
    );
  });

  it('a ticket linked to an asset shows which services that asset affects', async () => {
    const service = await createService(tenantId, { name: 'Support Portal' });
    const webServer = await createAsset(tenantId, { name: 'portal-web01', assetType: 'SERVER' });
    await linkAssetToService(tenantId, service.id, webServer.id);

    const ticket = await createTicketFromApi(tenantId, {
      subject: 'Portal is down',
      body: 'body',
      contactEmail: 'ops@example.com',
      contactName: 'Ops',
    });
    await linkAssetToTicket(tenantId, ticket.id, webServer.id);

    const fetched = await getTicket(tenantId, ticket.id);
    expect(fetched.assets).toHaveLength(1);
    expect(fetched.assets[0].asset.services.map((s) => s.name)).toEqual(['Support Portal']);
  });

  it('deletes a service and rejects deleting one that does not exist', async () => {
    const service = await createService(tenantId, { name: 'Temporary Service' });
    await deleteService(tenantId, service.id);

    const services = await listServices(tenantId);
    expect(services.find((s) => s.id === service.id)).toBeUndefined();

    await expect(deleteService(tenantId, service.id)).rejects.toThrow('service not found');
  });
});
