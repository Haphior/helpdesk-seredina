import { prisma, withTenantTx } from '@seredina/db';
import type { WebhookEvent } from '@seredina/shared';
import { webhookDeliveryQueue } from './queue';
import { publishLive } from './live';

/**
 * Mirrors apps/api/src/lib/webhookDispatch.ts -- duplicated rather than imported
 * across the apps/api <-> apps/worker boundary so each deployable app stays
 * self-contained (same reasoning as webhooks/deliver.ts already querying Prisma
 * directly instead of calling into apps/api's ticket service). Used only for
 * events that can legitimately originate IN the worker, like an SLA breach
 * discovered by a delayed check job -- everything else still dispatches from
 * apps/api's request/service layer.
 */
export async function dispatchWebhookEvent(tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
  // Same as apps/api's copy: open consoles hear about it too, id only.
  if (event.startsWith('sla.') && typeof data.ticketId === 'string') {
    await publishLive(tenantId, { type: 'sla.breached', ticketId: data.ticketId });
  }

  const webhooks = await withTenantTx(prisma, tenantId, (tx) =>
    tx.webhook.findMany({ where: { isActive: true, events: { has: event } }, select: { id: true } }),
  );
  if (webhooks.length === 0) return;

  const occurredAt = new Date().toISOString();
  await Promise.all(
    webhooks.map((w) =>
      webhookDeliveryQueue.add(
        'deliver',
        { webhookId: w.id, tenantId, event, occurredAt, data },
        { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
      ),
    ),
  );
}
