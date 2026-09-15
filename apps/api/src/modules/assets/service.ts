import { prisma, withTenantTx, type AssetStatus, type AssetType } from '@seredina/db';

export interface AssetInput {
  name: string;
  assetType: AssetType;
  status?: AssetStatus;
  ipAddress?: string | null;
  macAddress?: string | null;
  hostname?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  operatingSystem?: string | null;
}

/** Hand-entered assets, as opposed to the agentless scanner (apps/worker) -- discoverySource stays MANUAL. */
export async function createAsset(tenantId: string, input: AssetInput) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.asset.create({ data: { tenantId, discoverySource: 'MANUAL', ...input } }),
  );
}

export async function updateAsset(tenantId: string, id: string, input: Partial<AssetInput>) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.asset.findUnique({ where: { id } });
    if (!existing) throw new Error('asset not found');
    return tx.asset.update({ where: { id }, data: input });
  });
}

export async function deleteAsset(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.asset.findUnique({ where: { id } });
    if (!existing) throw new Error('asset not found');
    await tx.asset.delete({ where: { id } });
  });
}

export async function listAssets(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) => tx.asset.findMany({ orderBy: { name: 'asc' } }));
}

export async function getAsset(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      include: { tickets: { include: { ticket: { select: { id: true, number: true, subject: true } } } } },
    });
    if (!asset) throw new Error('asset not found');
    return asset;
  });
}

/** Lightweight CMDB linkage: "this ticket is about that asset" -- see schema.prisma's TicketAsset. */
export async function linkAssetToTicket(tenantId: string, ticketId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const [ticket, asset] = await Promise.all([
      tx.ticket.findUnique({ where: { id: ticketId } }),
      tx.asset.findUnique({ where: { id: assetId } }),
    ]);
    if (!ticket) throw new Error('ticket not found');
    if (!asset) throw new Error('asset not found');

    return tx.ticketAsset.upsert({
      where: { ticketId_assetId: { ticketId, assetId } },
      create: { tenantId, ticketId, assetId },
      update: {},
    });
  });
}

export async function unlinkAssetFromTicket(tenantId: string, ticketId: string, assetId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new Error('ticket not found');
    await tx.ticketAsset.deleteMany({ where: { ticketId, assetId } });
  });
}
