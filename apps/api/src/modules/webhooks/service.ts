import { randomBytes } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { encryptSecret, type WebhookEvent } from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

// Never select secretEncrypted back out -- same reasoning as EmailChannel's
// SAFE_SELECT. The plaintext secret is shown exactly once, in createWebhook's
// return value, and never again -- same shape as ApiKey, except a webhook's
// secret also has to be recoverable later (to sign every delivery), which is why
// it's encrypted rather than hashed.
const SAFE_SELECT = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
  lastDeliveryAt: true,
  lastDeliveryStatus: true,
} as const;

export async function listWebhooks(tenantId: string) {
  return withTenantTx(prisma, tenantId, (tx) =>
    tx.webhook.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'desc' } }),
  );
}

export interface CreateWebhookInput {
  url: string;
  events: WebhookEvent[];
}

export async function createWebhook(tenantId: string, input: CreateWebhookInput) {
  if (!input.url.startsWith('https://')) {
    throw new Error('webhook URL must use https://');
  }

  const secret = randomBytes(32).toString('hex');
  const secretEncrypted = encryptSecret(secret, ENCRYPTION_KEY!);

  const webhook = await withTenantTx(prisma, tenantId, (tx) =>
    tx.webhook.create({
      data: { tenantId, url: input.url, events: input.events, secretEncrypted },
      select: SAFE_SELECT,
    }),
  );

  return { ...webhook, secret };
}

export async function deleteWebhook(tenantId: string, id: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.webhook.findUnique({ where: { id } });
    if (!existing) throw new Error('webhook not found');
    await tx.webhook.delete({ where: { id } });
  });
}

export interface UpdateWebhookInput {
  url?: string;
  events?: WebhookEvent[];
  isActive?: boolean;
}

/**
 * Never touches secretEncrypted -- rotating the signing secret is its own
 * explicit action (rotateWebhookSecret below), not a side effect of editing
 * the URL or event list. A plain "edit" changing the secret out from under an
 * operator who didn't ask for that would silently break their delivery
 * verification.
 */
export async function updateWebhook(tenantId: string, id: string, input: UpdateWebhookInput) {
  if (input.url && !input.url.startsWith('https://')) {
    throw new Error('webhook URL must use https://');
  }
  return withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.webhook.findUnique({ where: { id } });
    if (!existing) throw new Error('webhook not found');
    return tx.webhook.update({
      where: { id },
      data: { url: input.url, events: input.events, isActive: input.isActive },
      select: SAFE_SELECT,
    });
  });
}

/** Shown once, exactly like createWebhook's -- the old secret stops verifying deliveries immediately. */
export async function rotateWebhookSecret(tenantId: string, id: string) {
  const secret = randomBytes(32).toString('hex');
  const secretEncrypted = encryptSecret(secret, ENCRYPTION_KEY!);

  const webhook = await withTenantTx(prisma, tenantId, async (tx) => {
    const existing = await tx.webhook.findUnique({ where: { id } });
    if (!existing) throw new Error('webhook not found');
    return tx.webhook.update({ where: { id }, data: { secretEncrypted }, select: SAFE_SELECT });
  });

  return { ...webhook, secret };
}
