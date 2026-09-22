import { prisma, withTenantTx } from '@seredina/db';
import type { WebhookEvent } from '@seredina/shared';
import { webhookDeliveryQueue } from './queue';
import { publishLive } from './live';

const LIVE_EVENT_FOR: Partial<Record<WebhookEvent, 'ticket.created' | 'ticket.updated' | 'message.created'>> = {
  'ticket.created': 'ticket.created',
  'ticket.updated': 'ticket.updated',
  'message.created': 'message.created',
};

/**
 * Fire-and-forget: looks up active webhooks subscribed to `event` (a short read-
 * only tx) then enqueues one delivery job per webhook OUTSIDE that tx -- same
 * "never do slow I/O inside withTenantTx" rule as email send. Callers await this
 * after their own tx has already committed, never from inside one.
 */
export async function dispatchWebhookEvent(tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
  // Every ticket/message change already funnels through here after its commit,
  // so this is also where open consoles hear about it (docs/adr/0053-live-updates.md).
  // Only the id goes out -- see packages/shared/src/liveEvents.ts.
  const liveType = LIVE_EVENT_FOR[event];
  if (liveType && typeof data.ticketId === 'string') {
    await publishLive(tenantId, { type: liveType, ticketId: data.ticketId });
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
        // A receiving endpoint being briefly down/slow is the expected failure
        // mode, not the exception -- retry with backoff before giving up and
        // recording a terminal failure on the webhook (apps/worker/src/index.ts's
        // 'failed' handler).
        { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
      ),
    ),
  );
}
