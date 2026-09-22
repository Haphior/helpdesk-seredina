import { createHmac } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { CHAT_WEBHOOK_EVENTS, decryptSecret, ssrfSafeFetch, type ChatWebhookEvent, type WebhookDeliveryJobPayload } from '@seredina/shared';
import { formatChatMessage } from './chatMessage';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

const DELIVERY_TIMEOUT_MS = 10_000;

function isChatWebhookEvent(event: string): event is ChatWebhookEvent {
  return (CHAT_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

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

  // 'slack'/'teams' post the plain {"text": "..."} shape both platforms'
  // current real webhook mechanisms accept (Slack Incoming Webhooks, Teams
  // Workflows -- confirmed against Teams' own live docs, not assumed) and skip
  // signing entirely: neither has an HMAC-verification concept, so there's no
  // secretEncrypted to decrypt for these (see docs/adr/0048-chat-notifications.md).
  const isChatKind = webhook.kind === 'slack' || webhook.kind === 'teams';
  let body: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (isChatKind) {
    if (!isChatWebhookEvent(payload.event)) {
      throw new Error(`${webhook.kind} webhook received an unsupported event: ${payload.event}`);
    }
    body = JSON.stringify({ text: formatChatMessage(payload.event, payload.data) });
  } else {
    const secret = decryptSecret(webhook.secretEncrypted!, ENCRYPTION_KEY!);
    body = JSON.stringify({ event: payload.event, occurredAt: payload.occurredAt, data: payload.data });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    headers = { ...headers, 'X-Seredina-Signature': `sha256=${signature}` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    // ssrfSafeFetch checks every resolved address and never follows a
    // redirect, so a 3xx lands here as !ok -- see packages/shared/src/ssrf.ts
    // for the honest scope of what this does and doesn't cover.
    const response = await ssrfSafeFetch(webhook.url, { method: 'POST', headers, body, signal: controller.signal });
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
