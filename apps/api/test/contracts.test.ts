import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { contractStatus, contractSummary, createContract, daysUntil, deleteContract, listContracts, updateContract } from '../src/modules/contracts/service';
import { sendDueContractReminders } from '../../worker/src/contracts/renewalCheck';
import { createRole, createUser } from '../src/modules/auth/service';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { exportTenantData } from '../src/modules/export/service';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 24 * 60 * 60 * 1000));

describe('contract status', () => {
  const now = new Date('2026-09-23T15:00:00Z');
  it('derives active / expiring / expired from the end date and notice window', () => {
    expect(daysUntil(new Date('2026-09-23T00:00:00Z'), now)).toBe(0);
    expect(contractStatus({ endDate: new Date('2026-12-31T00:00:00Z'), renewalNoticeDays: 30 }, now)).toBe('active');
    expect(contractStatus({ endDate: new Date('2026-10-10T00:00:00Z'), renewalNoticeDays: 30 }, now)).toBe('expiring');
    expect(contractStatus({ endDate: new Date('2026-09-22T00:00:00Z'), renewalNoticeDays: 30 }, now)).toBe('expired');
    expect(contractStatus({ endDate: null, renewalNoticeDays: 30 }, now)).toBe('no_end_date');
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('contracts', () => {
  let tenantId: string;
  let otherTenantId: string;
  let laptopId: string;
  let serverId: string;
  let foreignAssetId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `contracts-${tenantId.slice(0, 8)}`, name: 'Contracts' } });
      await seedDefaultTicketStatuses(tx, tenantId);
      laptopId = (await tx.asset.create({ data: { tenantId, name: 'Laptop 7' } })).id;
      serverId = (await tx.asset.create({ data: { tenantId, name: 'File server' } })).id;
    });
    await withTenantTx(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, slug: `contracts-o-${otherTenantId.slice(0, 8)}`, name: 'Other' } });
      foreignAssetId = (await tx.asset.create({ data: { tenantId: otherTenantId, name: 'Not yours' } })).id;
    });
    await createRole(tenantId, { key: 'asset_manager', name: 'Asset manager', permissions: ['assets:read', 'assets:manage'] });
    await createRole(tenantId, { key: 'reader', name: 'Reader', permissions: ['tickets:read'] });
    await createUser(tenantId, { email: 'am@c.test', name: 'AM', password: 'password-123', roleKey: 'asset_manager' }, ['assets:read', 'assets:manage']);
    await createUser(tenantId, { email: 'r@c.test', name: 'R', password: 'password-123', roleKey: 'reader' }, ['tickets:read']);
  });

  it('creates a contract linked to assets, and lists it by asset and status', async () => {
    const warranty = await createContract(tenantId, {
      name: 'Laptop warranty',
      type: 'WARRANTY',
      supplier: 'Dell',
      endDate: inDays(10),
      renewalNoticeDays: 30,
      assetIds: [laptopId],
    });
    expect(warranty.status).toBe('expiring');
    expect(warranty.assets.map((a) => a.name)).toEqual(['Laptop 7']);

    await createContract(tenantId, { name: 'Office 365', type: 'SUBSCRIPTION', endDate: inDays(200), cost: 1200, currency: 'usd', billingPeriod: 'yearly', seats: 25 });
    await createContract(tenantId, { name: 'Old support', type: 'SUPPORT', endDate: inDays(-5), cost: 100, currency: 'USD', billingPeriod: 'monthly', assetIds: [serverId] });

    expect((await listContracts(tenantId, { assetId: laptopId })).map((c) => c.name)).toEqual(['Laptop warranty']);
    expect((await listContracts(tenantId, { status: 'expired' })).map((c) => c.name)).toEqual(['Old support']);
    expect((await listContracts(tenantId, { search: 'dell' })).map((c) => c.name)).toEqual(['Laptop warranty']);

    const summary = await contractSummary(tenantId);
    expect(summary).toMatchObject({ total: 3, expiring: 1, expired: 1 });
    // Expired contracts don't count toward the running cost.
    expect(summary.recurringYearlyCost).toEqual([{ currency: 'USD', amount: 1200 }]);
  });

  it('refuses to link another tenant\'s asset', async () => {
    await expect(createContract(tenantId, { name: 'Sneaky', type: 'OTHER', assetIds: [foreignAssetId] })).rejects.toThrow(/assets not found/);
  });

  it('reminds asset managers once per end date, and again after a renewal', async () => {
    await sendDueContractReminders();
    const notificationsFor = (email: string) =>
      withTenantTx(prisma, tenantId, async (tx) => {
        const user = await tx.user.findFirstOrThrow({ where: { email } });
        return tx.notification.findMany({ where: { userId: user.id, eventType: 'CONTRACT_EXPIRING' } });
      });

    const first = await notificationsFor('am@c.test');
    expect(first).toHaveLength(1);
    expect(first[0].body).toContain('Laptop warranty');
    expect(first[0].body).toContain('Laptop 7');
    expect(await notificationsFor('r@c.test')).toHaveLength(0);

    // Running again sends nothing new.
    await sendDueContractReminders();
    expect(await notificationsFor('am@c.test')).toHaveLength(1);

    // Renewed to a new end date inside the window again: a new reminder is due.
    const [warranty] = await listContracts(tenantId, { search: 'Laptop warranty' });
    await updateContract(tenantId, warranty.id, { endDate: inDays(20) });
    await sendDueContractReminders();
    expect(await notificationsFor('am@c.test')).toHaveLength(2);
  });

  it('is part of the data export, and deleting a contract leaves its assets alone', async () => {
    const data = await exportTenantData(tenantId);
    expect(data.contracts.length).toBe(3);
    expect(data.contractAssets.length).toBe(2);

    const [old] = await listContracts(tenantId, { status: 'expired' });
    await deleteContract(tenantId, old.id);
    const server = await withTenantTx(prisma, tenantId, (tx) => tx.asset.findUnique({ where: { id: serverId } }));
    expect(server).not.toBeNull();
  });
});
