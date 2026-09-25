import { anonymizeContactInTx, prisma, withTenantTx } from '@seredina/db';

/**
 * Automatic contact retention (docs/adr/0066-contact-data-rights.md): in
 * tenants that turned it on, contacts with no open ticket and no activity for
 * longer than the retention period are anonymized, exactly as an admin would
 * do by hand, and each one is recorded in the audit log.
 */
export async function anonymizeContactsPastRetention(): Promise<number> {
  // Cross-tenant discovery, ids only -- see list_contacts_due_for_retention in rls/policies.sql.
  const due = await prisma.$queryRaw<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM list_contacts_due_for_retention()
  `;

  let anonymized = 0;
  for (const { id, tenant_id: tenantId } of due) {
    try {
      await withTenantTx(prisma, tenantId, async (tx) => {
        const result = await anonymizeContactInTx(tx, id);
        if (result.alreadyAnonymized) return;
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { contactRetentionDays: true } });
        // Same transaction as the erasure: an erasure never goes unrecorded.
        await tx.auditLog.create({
          data: {
            tenantId,
            action: 'contact.anonymized',
            actorType: 'system',
            actorLabel: 'retention policy',
            targetType: 'contact',
            targetId: id,
            metadata: {
              retentionDays: tenant.contactRetentionDays,
              tickets: result.tickets,
              messages: result.messages,
              attachments: result.attachments,
            },
          },
        });
        anonymized++;
      });
    } catch (err) {
      console.error(`[worker] contact retention ${id} (tenant ${tenantId}) failed:`, err);
    }
  }
  return anonymized;
}
