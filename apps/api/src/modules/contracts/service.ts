import { Prisma, prisma, withTenantTx, type ContractType } from '@seredina/db';

/**
 * Contracts, warranties and licenses, linked to assets -- docs/adr/0062-contracts.md.
 * Status is derived from the end date, never stored, so it can't go stale.
 */

export type ContractStatus = 'active' | 'expiring' | 'expired' | 'no_end_date';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until endDate (negative once past), counting whole calendar days in UTC. */
export function daysUntil(endDate: Date, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
  return Math.round((end - today) / DAY_MS);
}

export function contractStatus(c: { endDate: Date | null; renewalNoticeDays: number }, now = new Date()): ContractStatus {
  if (!c.endDate) return 'no_end_date';
  const days = daysUntil(c.endDate, now);
  if (days < 0) return 'expired';
  if (days <= Math.max(c.renewalNoticeDays, 0)) return 'expiring';
  return 'active';
}

export interface ContractInput {
  name: string;
  type: ContractType;
  supplier?: string | null;
  reference?: string | null;
  startDate?: string | null; // YYYY-MM-DD
  endDate?: string | null;
  renewalNoticeDays?: number;
  cost?: number | null;
  currency?: string | null;
  billingPeriod?: 'one_time' | 'monthly' | 'yearly' | null;
  seats?: number | null;
  notes?: string | null;
  assetIds?: string[];
}

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`));

function present(c: Prisma.ContractGetPayload<{ include: { assets: { include: { asset: { select: { id: true; name: true; assetType: true } } } } } }>) {
  const { assets, cost, ...rest } = c;
  return {
    ...rest,
    cost: cost === null ? null : Number(cost),
    status: contractStatus(c),
    daysUntilEnd: c.endDate ? daysUntil(c.endDate) : null,
    assets: assets.map((a) => a.asset),
  };
}

const INCLUDE = { assets: { include: { asset: { select: { id: true, name: true, assetType: true } } } } } as const;

export interface ContractFilter {
  status?: ContractStatus;
  assetId?: string;
  search?: string;
}

export async function listContracts(tenantId: string, filter: ContractFilter = {}) {
  const rows = await withTenantTx(prisma, tenantId, (tx) =>
    tx.contract.findMany({
      where: {
        ...(filter.assetId ? { assets: { some: { assetId: filter.assetId } } } : {}),
        ...(filter.search
          ? {
              OR: [
                { name: { contains: filter.search, mode: 'insensitive' } },
                { supplier: { contains: filter.search, mode: 'insensitive' } },
                { reference: { contains: filter.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    }),
  );
  const contracts = rows.map(present);
  return filter.status ? contracts.filter((c) => c.status === filter.status) : contracts;
}

export async function getContract(tenantId: string, id: string) {
  const row = await withTenantTx(prisma, tenantId, (tx) => tx.contract.findUnique({ where: { id }, include: INCLUDE }));
  if (!row) throw new Error('contract not found');
  return present(row);
}

async function assertAssetsExist(tx: Prisma.TransactionClient, assetIds: string[]) {
  if (assetIds.length === 0) return;
  // RLS scopes this to the tenant: an id from another tenant simply isn't found.
  const found = await tx.asset.count({ where: { id: { in: assetIds } } });
  if (found !== new Set(assetIds).size) throw new Error('one or more assets not found');
}

function dataFrom(input: Partial<ContractInput>) {
  return {
    name: input.name,
    type: input.type,
    supplier: input.supplier,
    reference: input.reference,
    startDate: toDate(input.startDate),
    endDate: toDate(input.endDate),
    renewalNoticeDays: input.renewalNoticeDays,
    cost: input.cost === undefined ? undefined : input.cost === null ? null : new Prisma.Decimal(input.cost),
    currency: input.currency === undefined ? undefined : input.currency ? input.currency.toUpperCase() : null,
    billingPeriod: input.billingPeriod,
    seats: input.seats,
    notes: input.notes,
  };
}

export async function createContract(tenantId: string, input: ContractInput) {
  const id = await withTenantTx(prisma, tenantId, async (tx) => {
    const assetIds = [...new Set(input.assetIds ?? [])];
    await assertAssetsExist(tx, assetIds);
    const contract = await tx.contract.create({ data: { tenantId, ...dataFrom(input), name: input.name, type: input.type } });
    for (const assetId of assetIds) {
      await tx.contractAsset.create({ data: { tenantId, contractId: contract.id, assetId } });
    }
    return contract.id;
  });
  return getContract(tenantId, id);
}

export async function updateContract(tenantId: string, id: string, input: Partial<ContractInput>) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.contract.findUnique({ where: { id } });
    if (!existing) throw new Error('contract not found');
    const data: Prisma.ContractUpdateInput = dataFrom(input);
    // A new end date (a renewal) or notice period means a new reminder is due.
    const newEnd = toDate(input.endDate);
    if (
      (newEnd !== undefined && (newEnd?.getTime() ?? null) !== (existing.endDate?.getTime() ?? null)) ||
      (input.renewalNoticeDays !== undefined && input.renewalNoticeDays !== existing.renewalNoticeDays)
    ) {
      data.renewalNotifiedAt = null;
    }
    await tx.contract.update({ where: { id }, data });

    if (input.assetIds) {
      const assetIds = [...new Set(input.assetIds)];
      await assertAssetsExist(tx, assetIds);
      await tx.contractAsset.deleteMany({ where: { contractId: id } });
      for (const assetId of assetIds) {
        await tx.contractAsset.create({ data: { tenantId, contractId: id, assetId } });
      }
    }
  });
  return getContract(tenantId, id);
}

export async function deleteContract(tenantId: string, id: string) {
  await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.contract.findUnique({ where: { id } });
    if (!existing) throw new Error('contract not found');
    await tx.contract.delete({ where: { id } });
  });
}

/** For the dashboard and the Contracts page header. */
export async function contractSummary(tenantId: string) {
  const contracts = await listContracts(tenantId);
  const yearly = (c: { cost: number | null; billingPeriod: string | null }) =>
    c.cost === null ? 0 : c.billingPeriod === 'monthly' ? c.cost * 12 : c.billingPeriod === 'yearly' ? c.cost : 0;
  const byCurrency = new Map<string, number>();
  for (const c of contracts) {
    if (c.status === 'expired' || !c.currency) continue;
    const y = yearly(c);
    if (y) byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + y);
  }
  return {
    total: contracts.length,
    expiring: contracts.filter((c) => c.status === 'expiring').length,
    expired: contracts.filter((c) => c.status === 'expired').length,
    recurringYearlyCost: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
  };
}
