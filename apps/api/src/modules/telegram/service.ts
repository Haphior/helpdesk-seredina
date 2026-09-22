import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { callTelegramApi, decryptSecret, encryptSecret, type TelegramGetMeResult, type TelegramUpdate } from '@seredina/shared';
import { addMessage, createTicketFromApi } from '../tickets/service';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

/** Never includes the token itself, decrypted or not -- see modules/telegram/routes.ts. */
export interface TelegramChannelView {
  connected: boolean;
  botUsername: string | null;
}

const DISCONNECTED_VIEW: TelegramChannelView = { connected: false, botUsername: null };

function toView(row: { botUsername: string } | null): TelegramChannelView {
  return row ? { connected: true, botUsername: row.botUsername } : DISCONNECTED_VIEW;
}

export async function getTelegramChannel(tenantId: string): Promise<TelegramChannelView> {
  return withTenantTx(prisma, tenantId, async (tx) =>
    toView(await tx.telegramChannel.findUnique({ where: { tenantId }, select: { botUsername: true } })),
  );
}

/**
 * Validates the token against Telegram's own getMe -- a real, live check, so a
 * malformed or revoked token fails right here with Telegram's own error
 * message, never accepted and only discovered broken on the first real
 * message. Then registers our webhook with Telegram so it starts pushing this
 * tenant's messages to us. See docs/adr/0044-telegram-channel.md for why
 * webhookId+webhookSecret, not the bot token itself, is what routes and
 * authenticates the incoming webhook.
 */
export async function connectTelegramChannel(tenantId: string, botToken: string): Promise<TelegramChannelView> {
  const publicUrl = process.env.API_PUBLIC_URL;
  if (!publicUrl) {
    throw new Error(
      'API_PUBLIC_URL must be configured to connect a Telegram bot (Telegram requires a real, internet-reachable HTTPS URL for its webhook)',
    );
  }

  const me = await callTelegramApi<TelegramGetMeResult>(botToken, 'getMe');

  const webhookId = randomBytes(24).toString('hex');
  const webhookSecret = randomBytes(32).toString('hex');

  await callTelegramApi(botToken, 'setWebhook', {
    url: `${publicUrl.replace(/\/$/, '')}/v1/integrations/telegram/webhook/${webhookId}`,
    secret_token: webhookSecret,
  });

  const botTokenEncrypted = encryptSecret(botToken, ENCRYPTION_KEY!);
  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.telegramChannel.upsert({
      where: { tenantId },
      create: { tenantId, botUsername: me.username, botTokenEncrypted, webhookId, webhookSecret },
      update: { botUsername: me.username, botTokenEncrypted, webhookId, webhookSecret },
      select: { botUsername: true },
    }),
  );
  return toView(row);
}

export async function disconnectTelegramChannel(tenantId: string): Promise<void> {
  const existing = await withTenantTx(prisma, tenantId, (tx) => tx.telegramChannel.findUnique({ where: { tenantId } }));
  if (!existing) return;

  // Best-effort: the bot may already be deleted/revoked on Telegram's own side --
  // that must never block removing our own local config.
  try {
    const botToken = decryptSecret(existing.botTokenEncrypted, ENCRYPTION_KEY!);
    await callTelegramApi(botToken, 'deleteWebhook');
  } catch {
    // ignore, see above
  }

  await withTenantTx(prisma, tenantId, (tx) => tx.telegramChannel.delete({ where: { tenantId } }));
}

/** No tenant context yet -- see resolve_tenant_id_by_telegram_webhook in rls/policies.sql. */
export async function resolveTenantIdByTelegramWebhook(webhookId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ tenant_id: string | null }[]>`SELECT resolve_tenant_id_by_telegram_webhook(${webhookId}) AS tenant_id`;
  return rows[0]?.tenant_id ?? null;
}

/** True only when the tenant resolved above really has a channel AND the header Telegram sent matches its stored secret. */
export async function verifyTelegramWebhookSecret(tenantId: string, secretFromHeader: string | undefined): Promise<boolean> {
  if (!secretFromHeader) return false;
  const channel = await withTenantTx(prisma, tenantId, (tx) =>
    tx.telegramChannel.findUnique({ where: { tenantId }, select: { webhookSecret: true } }),
  );
  if (!channel?.webhookSecret) return false;
  // Constant-time compare (hashing first gives both sides equal length) so
  // response timing can't leak how much of a guessed secret was right.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(channel.webhookSecret), digest(secretFromHeader));
}

function contactFromTelegramUser(from: NonNullable<TelegramUpdate['message']>['from'], chatId: number) {
  const name =
    [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim() ||
    (from?.username ? `@${from.username}` : `Telegram user ${chatId}`);
  // Contact.email is the tenant-unique key every channel already upserts against
  // (see createTicketFromApi) -- a Telegram chat has no email of its own, so this
  // synthesizes a stable, obviously-not-a-real-address one from the chat id rather
  // than adding a second identity column to Contact for one channel.
  return { email: `telegram-${chatId}@telegram.local`, name };
}

/**
 * One ticket per open conversation, exactly like ingestAlert's own re-fire
 * fold (ADR 0003): a follow-up message while the ticket is still open
 * continues it, one after it's closed starts a fresh ticket -- the chat id
 * (Ticket.externalId) is what threads them together. Non-text updates
 * (photos, stickers, edited messages, ...) are a deliberate v1 scope cut,
 * silently ignored by the caller (see routes.ts) rather than erroring.
 */
export async function handleTelegramUpdate(tenantId: string, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const externalId = String(chatId);

  const existing = await withTenantTx(prisma, tenantId, (tx) =>
    tx.ticket.findFirst({
      where: { channel: 'telegram', externalId, status: { category: { not: 'CLOSED' } } },
      orderBy: { createdAt: 'desc' },
    }),
  );

  if (existing) {
    await addMessage(tenantId, existing.id, { authorType: 'CONTACT', body: message.text, isPrivateNote: false });
    return;
  }

  const contact = contactFromTelegramUser(message.from, chatId);
  await createTicketFromApi(tenantId, {
    subject: message.text.length > 80 ? `${message.text.slice(0, 80)}…` : message.text,
    body: message.text,
    contactEmail: contact.email,
    contactName: contact.name,
    channel: 'telegram',
    externalId,
  });
}
