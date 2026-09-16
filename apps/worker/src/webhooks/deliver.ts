import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { prisma, withTenantTx } from '@seredina/db';
import { decryptSecret, isPrivateOrReservedIp, type WebhookDeliveryJobPayload } from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * BullMQ's own retry/backoff (configured on the Worker in index.ts) handles
 * transient failures -- this function's job is just: attempt one delivery, throw
 * on any failure so BullMQ counts it and retries, record the outcome on success.
 */
export async function deliverWebhook(payload: WebhookDeliveryJobPayload): Promise<void> {
  const webhook = await withTenantTx(prisma, payload.tenantId, (tx) =>
    tx.webhook.findUnique({ where: { id: payload.webhookId } }),
  );
  // Deleted or deactivated since the job was enqueued -- not a failure, just
  // nothing to do anymore.
  if (!webhook || !webhook.isActive) return;

  const url = new URL(webhook.url);
  if (url.protocol !== 'https:') {
    throw new Error(`refusing to deliver to non-https URL: ${webhook.url}`);
  }

  // Best-effort SSRF guard, not DNS-rebinding-proof -- see
  // packages/shared/src/ssrf.ts and docs/adr/0009-outbound-webhooks.md for the
  // honest scope of what this does and doesn't cover.
  const resolved = await lookup(url.hostname);
  if (isPrivateOrReservedIp(resolved.address, resolved.family as 4 | 6)) {
    throw new Error(`refusing to deliver to a private/reserved address: ${resolved.address}`);
  }

  const secret = decryptSecret(webhook.secretEncrypted, ENCRYPTION_KEY!);
  const body = JSON.stringify({ event: payload.event, occurredAt: payload.occurredAt, data: payload.data });
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Seredina-Signature': `sha256=${signature}` },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`webhook endpoint responded ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }

  await withTenantTx(prisma, payload.tenantId, (tx) =>
    tx.webhook.update({ where: { id: webhook.id }, data: { lastDeliveryAt: new Date(), lastDeliveryStatus: 'success' } }),
  );
}

/** Called from the Worker's 'failed' handler once BullMQ has exhausted all retries -- records the terminal failure, doesn't retry itself. */
export async function markWebhookDeliveryFailed(payload: WebhookDeliveryJobPayload): Promise<void> {
  await withTenantTx(prisma, payload.tenantId, (tx) =>
    tx.webhook.updateMany({
      where: { id: payload.webhookId },
      data: { lastDeliveryAt: new Date(), lastDeliveryStatus: 'failed' },
    }),
  ).catch(() => {}); // best-effort bookkeeping; never let this throw out of a failure handler
}
