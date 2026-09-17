import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createService, getPublicStatusPage, linkAssetToService } from '../src/modules/services/service';
import { createAsset } from '../src/modules/assets/service';
import { createTicketFromApi, listTicketStatuses, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';
import { linkAssetToTicket } from '../src/modules/assets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Public status page', () => {
  let tenantId: string;

  async function makeTicket(priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT', channel: string, assetId: string) {
    const ticket = await createTicketFromApi(tenantId, {
      subject: `alert-${randomUUID()}`,
      body: 'body',
      contactEmail: `alert-${randomUUID()}@alerts.local`,
      contactName: 'Monitor',
      priority,
      channel,
    });
    await linkAssetToTicket(tenantId, ticket.id, assetId);
    return ticket;
  }

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `status-${tenantId.slice(0, 8)}`, name: 'Status Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
  });

  it('reports "operational" for a service with no assets and no incidents', async () => {
    const service = await createService(tenantId, { name: 'Untouched Service' });
    const page = await getPublicStatusPage(tenantId);
    const entry = page.services.find((s) => s.id === service.id);
    expect(entry?.status).toBe('operational');
    expect(entry?.openIncidents).toBe(0);
  });

  it('reports "degraded" when an open, LOW/NORMAL-priority alert ticket is linked to an underlying asset', async () => {
    const asset = await createAsset(tenantId, { name: 'mail-server-1', assetType: 'SERVER' });
    const service = await createService(tenantId, { name: 'Email' });
    await linkAssetToService(tenantId, service.id, asset.id);
    await makeTicket('NORMAL', 'alert', asset.id);

    const page = await getPublicStatusPage(tenantId);
    const entry = page.services.find((s) => s.id === service.id);
    expect(entry?.status).toBe('degraded');
    expect(entry?.openIncidents).toBe(1);
    expect(page.overall).toBe('degraded');
  });

  it('reports "outage" (and bumps the tenant-wide overall) when a HIGH/URGENT-priority alert ticket is linked', async () => {
    const asset = await createAsset(tenantId, { name: 'db-server-1', assetType: 'SERVER' });
    const service = await createService(tenantId, { name: 'Payroll' });
    await linkAssetToService(tenantId, service.id, asset.id);
    await makeTicket('URGENT', 'alert', asset.id);

    const page = await getPublicStatusPage(tenantId);
    const entry = page.services.find((s) => s.id === service.id);
    expect(entry?.status).toBe('outage');
    expect(page.overall).toBe('outage');
  });

  it('ignores a non-alert-channel ticket linked to the same asset, however high its priority', async () => {
    const asset = await createAsset(tenantId, { name: 'printer-1', assetType: 'PRINTER' });
    const service = await createService(tenantId, { name: 'Printing' });
    await linkAssetToService(tenantId, service.id, asset.id);
    await makeTicket('URGENT', 'api', asset.id);

    const page = await getPublicStatusPage(tenantId);
    const entry = page.services.find((s) => s.id === service.id);
    expect(entry?.status).toBe('operational');
  });

  it('ignores an alert ticket once it is closed', async () => {
    const asset = await createAsset(tenantId, { name: 'vpn-gateway-1', assetType: 'NETWORK_DEVICE' });
    const service = await createService(tenantId, { name: 'VPN' });
    await linkAssetToService(tenantId, service.id, asset.id);
    const ticket = await makeTicket('URGENT', 'alert', asset.id);

    const statuses = await listTicketStatuses(tenantId);
    const closed = statuses.find((s) => s.key === 'closed');
    if (!closed) throw new Error('expected a closed status to exist');
    await updateTicket(tenantId, ticket.id, { statusId: closed.id });

    const page = await getPublicStatusPage(tenantId);
    const entry = page.services.find((s) => s.id === service.id);
    expect(entry?.status).toBe('operational');
  });

  it('never leaks a second tenant\'s incidents into this tenant\'s status page', async () => {
    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, slug: `status-other-${otherTenantId.slice(0, 8)}`, name: 'Other' } });
      await seedDefaultTicketStatuses(tx, otherTenantId);
    });

    const page = await getPublicStatusPage(otherTenantId);
    expect(page.services).toEqual([]);
    expect(page.overall).toBe('operational');
  });
});
