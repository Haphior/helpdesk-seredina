import { prisma, withTenantTx } from '@seredina/db';
import { callTelegramApi, decryptSecret } from '@seredina/shared';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

export async function sendTelegramMessage(tenantId: string, ticketId: string, messageId: string): Promise<void> {
  const data = await withTenantTx(prisma, tenantId, async (tx) => {
    const message = await tx.message.findUniqueOrThrow({ where: { id: messageId } });
    const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const channel = await tx.telegramChannel.findUnique({ where: { tenantId } });
    if (!channel) throw new Error('no Telegram channel configured for this tenant');
    if (!ticket.externalId) throw new Error(`telegram ticket ${ticketId} has no chat id (externalId)`);
    return { message, chatId: ticket.externalId, botTokenEncrypted: channel.botTokenEncrypted };
  });

  const botToken = decryptSecret(data.botTokenEncrypted, ENCRYPTION_KEY!);
  await callTelegramApi(botToken, 'sendMessage', { chat_id: data.chatId, text: data.message.body });
}
