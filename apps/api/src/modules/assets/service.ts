import { prisma, withTenantTx } from '@seredina/db';

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
