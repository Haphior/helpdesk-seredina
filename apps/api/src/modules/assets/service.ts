import { prisma, withTenantTx, type AssetStatus, type AssetType, type Prisma } from '@seredina/db';

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
  // Optional link into the equipment catalog -- see docs/adr/0007-equipment-catalog.md.
  // Independent of the free-text manufacturer/model fields above.
  modelId?: string | null;
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

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface ListAssetsFilter {
  assetType?: AssetType;
  status?: AssetStatus;
  // Case-insensitive match against name, IP, or hostname -- same posture as
  // ticket search (modules/tickets/service.ts): a console search box, not a
  // search product.
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listAssets(tenantId: string, filter: ListAssetsFilter = {}) {
  const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = filter.offset ?? 0;
  const where: Prisma.AssetWhereInput = {
    assetType: filter.assetType,
    status: filter.status,
    OR: filter.q
      ? [
          { name: { contains: filter.q, mode: 'insensitive' } },
          { ipAddress: { contains: filter.q, mode: 'insensitive' } },
          { hostname: { contains: filter.q, mode: 'insensitive' } },
        ]
      : undefined,
  };

  return withTenantTx(prisma, tenantId, async (tx) => {
    const [assets, total] = await Promise.all([
      tx.asset.findMany({
        where,
        orderBy: { name: 'asc' },
        include: { catalogModel: { include: { manufacturer: true } } },
        take: limit,
        skip: offset,
      }),
      tx.asset.count({ where }),
    ]);
    return { assets, total };
  });
}

export async function getAsset(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      include: {
        tickets: { include: { ticket: { select: { id: true, number: true, subject: true } } } },
        // Flattened below into a plain services[] -- same reasoning as
        // getTicket's identical flatten (modules/tickets/service.ts): the
        // frontend shouldn't need to know a ServiceAsset join table exists.
        services: { include: { service: { select: { id: true, name: true } } } },
        catalogModel: { include: { manufacturer: true } },
      },
    });
    if (!asset) throw new Error('asset not found');
    return { ...asset, services: asset.services.map((sa) => sa.service) };
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
