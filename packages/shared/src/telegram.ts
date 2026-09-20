// Shared between apps/api (producer) and apps/worker (consumer) so the queue name
// and payload shape can't drift between the two processes -- same reasoning as
// email.ts's EMAIL_SEND_QUEUE_NAME.

/** Outbound: an agent's reply on a channel='telegram' ticket that needs to go out
 * as a real Telegram message. Inbound is a webhook Telegram calls directly (see
 * docs/adr/0044-telegram-channel.md), not a queue -- there's nothing to poll. */
export const TELEGRAM_SEND_QUEUE_NAME = 'telegram-send';

export interface TelegramSendJobPayload {
  tenantId: string;
  ticketId: string;
  messageId: string;
}

// Raw HTTP against Telegram's Bot API (https://core.telegram.org/bots/api) -- no
// SDK, same "hand-write the small thing" posture as the widget's own vanilla-JS
// script. Lives here (not apps/api) because apps/worker needs it too (sendMessage,
// on an agent's reply) -- one implementation, not two that could drift, same
// reasoning as @seredina/db's resolveTenantIdByApiKeyHash. Every method's response
// shares one envelope shape, confirmed live against the real API (a bad token
// really does come back as `{ok:false,error_code,description}`), not assumed from
// docs alone.
interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export class TelegramApiError extends Error {}

export async function callTelegramApi<T = unknown>(
  botToken: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params ?? {}),
  });

  let body: TelegramApiResponse<T>;
  try {
    body = (await res.json()) as TelegramApiResponse<T>;
  } catch {
    throw new TelegramApiError(`Telegram API returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!body.ok) {
    throw new TelegramApiError(body.description ?? `Telegram API call to ${method} failed (HTTP ${res.status})`);
  }
  return body.result as T;
}

export interface TelegramGetMeResult {
  id: number;
  username: string;
  first_name: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
}
