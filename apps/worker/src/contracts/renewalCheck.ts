import { prisma, withTenantTx } from '@seredina/db';
import { notifyUser } from '../notifications/notify';

/**
 * Renewal reminders for contracts, warranties and licenses
 * (docs/adr/0064-contracts.md): once a contract is inside its notice window,
 * everyone who manages assets gets a CONTRACT_EXPIRING notification (in-app,
 * and email if they opted in) -- once per end date.
 */
export async function sendDueContractReminders(): Promise<number> {
  // Cross-tenant discovery, ids only -- see list_contracts_due_for_renewal_notice in rls/policies.sql.
  const due = await prisma.$queryRaw<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM list_contracts_due_for_renewal_notice()
  `;

  let sent = 0;
  for (const { id, tenant_id: tenantId } of due) {
    try {
      const claimed = await withTenantTx(prisma, tenantId, async (tx) => {
        // Claim it first: a second worker replica (or an overlapping run) finds
        // nothing left to claim and sends nothing.
        const { count } = await tx.contract.updateMany({ where: { id, renewalNotifiedAt: null }, data: { renewalNotifiedAt: new Date() } });
        if (count === 0) return null;
        const contract = await tx.contract.findUniqueOrThrow({
          where: { id },
          include: { assets: { include: { asset: { select: { name: true } } }, take: 5 } },
        });
        const recipients = await tx.user.findMany({
          where: { isActive: true, role: { permissions: { some: { permission: { key: 'assets:manage' } } } } },
          select: { id: true },
        });
        return { contract, recipients };
      });
      if (!claimed) continue;

      const { contract, recipients } = claimed;
      const end = contract.endDate!.toISOString().slice(0, 10);
      const assets = contract.assets.map((a) => a.asset.name);
      const assetNote = assets.length ? ` (${assets.join(', ')}${contract.assets.length === 5 ? ', …' : ''})` : '';
      const body = `${contract.name}${contract.supplier ? ` — ${contract.supplier}` : ''} ends on ${end}${assetNote}.`;
      for (const user of recipients) {
        await notifyUser(tenantId, user.id, 'CONTRACT_EXPIRING', { body, subject: `Contract ending ${end}: ${contract.name}` });
      }
      sent++;
    } catch (err) {
      console.error(`[worker] contract reminder ${id} (tenant ${tenantId}) failed:`, err);
    }
  }
  return sent;
}
