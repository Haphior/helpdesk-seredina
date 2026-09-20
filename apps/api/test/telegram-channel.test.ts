import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';

/**
 * callTelegramApi is the one real external-network boundary here (Telegram's
 * Bot API) -- mocked the same way this codebase's AI adapter tests avoid a
 * real, costly LLM call (TestProviderAdapter) while keeping everything else
 * (Postgres, RLS, AES-256-GCM encryption) real. See
 * docs/adr/0044-telegram-channel.md.
 */
vi.mock('@seredina/shared', async () => {
  const actual = await vi.importActual<typeof import('@seredina/shared')>('@seredina/shared');
  return { ...actual, callTelegramApi: vi.fn() };
});

import { callTelegramApi } from '@seredina/shared';
import { telegramSendQueue } from '../src/lib/queue';
import {
  connectTelegramChannel,
  disconnectTelegramChannel,
  getTelegramChannel,
  handleTelegramUpdate,
  resolveTenantIdByTelegramWebhook,
  verifyTelegramWebhookSecret,
} from '../src/modules/telegram/service';

const mockCallTelegramApi = vi.mocked(callTelegramApi);
const hasDb = Boolean(process.env.DATABASE_URL);

function mockSuccessfulConnect() {
  mockCallTelegramApi.mockImplementation(async (_token, method) => {
    if (method === 'getMe') return { id: 1, username: 'mybot', first_name: 'My Bot' } as never;
    return true as never;
  });
}

describe.skipIf(!hasDb)('Telegram channel', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `tg-${tenantId.slice(0, 8)}`, name: 'Telegram Tenant' } }),
    );
    mockCallTelegramApi.mockReset();
    process.env.API_PUBLIC_URL = 'https://api.example.test';
  });

  it('a fresh tenant has no telegram channel connected', async () => {
    expect(await getTelegramChannel(tenantId)).toEqual({ connected: false, botUsername: null });
  });

  it('connecting validates the token via getMe, registers a webhook, and GET reflects it', async () => {
    mockSuccessfulConnect();

    const result = await connectTelegramChannel(tenantId, 'fake-token');
    expect(result).toEqual({ connected: true, botUsername: 'mybot' });

    const setWebhookCall = mockCallTelegramApi.mock.calls.find(([, method]) => method === 'setWebhook');
    expect(setWebhookCall?.[2]).toMatchObject({
      url: expect.stringContaining('https://api.example.test/v1/integrations/telegram/webhook/'),
    });

    expect(await getTelegramChannel(tenantId)).toEqual({ connected: true, botUsername: 'mybot' });
  });

  it('rejects connecting without API_PUBLIC_URL configured', async () => {
    delete process.env.API_PUBLIC_URL;
    await expect(connectTelegramChannel(tenantId, 'fake-token')).rejects.toThrow('API_PUBLIC_URL');
    expect(mockCallTelegramApi).not.toHaveBeenCalled();
  });

  it('rejects a token Telegram itself rejects', async () => {
    mockCallTelegramApi.mockRejectedValue(new Error('Unauthorized'));
    await expect(connectTelegramChannel(tenantId, 'bad-token')).rejects.toThrow('Unauthorized');
    expect(await getTelegramChannel(tenantId)).toEqual({ connected: false, botUsername: null });
  });

  it('disconnecting calls deleteWebhook and removes the row', async () => {
    mockSuccessfulConnect();
    await connectTelegramChannel(tenantId, 'fake-token');
    mockCallTelegramApi.mockClear();
    mockCallTelegramApi.mockResolvedValue(true as never);

    await disconnectTelegramChannel(tenantId);

    expect(mockCallTelegramApi).toHaveBeenCalledWith(expect.any(String), 'deleteWebhook');
    expect(await getTelegramChannel(tenantId)).toEqual({ connected: false, botUsername: null });
  });

  it('disconnecting still removes the row even when Telegram rejects deleteWebhook (best-effort)', async () => {
    mockCallTelegramApi.mockImplementation(async (_token, method) => {
      if (method === 'getMe') return { id: 1, username: 'mybot', first_name: 'My Bot' } as never;
      if (method === 'setWebhook') return true as never;
      throw new Error('bot was deleted');
    });
    await connectTelegramChannel(tenantId, 'fake-token');

    await disconnectTelegramChannel(tenantId);
    expect(await getTelegramChannel(tenantId)).toEqual({ connected: false, botUsername: null });
  });

  it('resolveTenantIdByTelegramWebhook and verifyTelegramWebhookSecret work end to end', async () => {
    mockSuccessfulConnect();
    await connectTelegramChannel(tenantId, 'fake-token');

    const setWebhookCall = mockCallTelegramApi.mock.calls.find(([, method]) => method === 'setWebhook')!;
    const params = setWebhookCall[2] as { url: string; secret_token: string };
    const webhookId = params.url.split('/').pop()!;

    expect(await resolveTenantIdByTelegramWebhook(webhookId)).toBe(tenantId);
    expect(await verifyTelegramWebhookSecret(tenantId, params.secret_token)).toBe(true);
    expect(await verifyTelegramWebhookSecret(tenantId, 'wrong-secret')).toBe(false);
    expect(await verifyTelegramWebhookSecret(tenantId, undefined)).toBe(false);
  });

  it('an unknown webhookId resolves to no tenant', async () => {
    expect(await resolveTenantIdByTelegramWebhook('no-such-webhook-id')).toBeNull();
  });

  it('a telegram channel connected for one tenant is invisible to another -- RLS scoping applies here like any other tenant-owned row', async () => {
    mockSuccessfulConnect();
    await connectTelegramChannel(tenantId, 'fake-token');

    const otherTenantId = randomUUID();
    await withTenantTx(prisma, otherTenantId, (tx) =>
      tx.tenant.create({ data: { id: otherTenantId, slug: `tg-other-${otherTenantId.slice(0, 8)}`, name: 'Other Telegram Tenant' } }),
    );

    expect(await getTelegramChannel(otherTenantId)).toEqual({ connected: false, botUsername: null });
  });

  describe('handleTelegramUpdate', () => {
    beforeEach(async () => {
      await withTenantTx(prisma, tenantId, (tx) => seedDefaultTicketStatuses(tx, tenantId));
    });

    it('creates a new ticket on a text message from an unknown chat', async () => {
      await handleTelegramUpdate(tenantId, {
        update_id: 1,
        message: { message_id: 1, chat: { id: 555 }, text: 'Hello, I need help', from: { id: 555, first_name: 'Ana' } },
      });

      const ticket = await withTenantTx(prisma, tenantId, (tx) =>
        tx.ticket.findFirst({ where: { channel: 'telegram', externalId: '555' }, include: { contact: true, messages: true } }),
      );
      expect(ticket).not.toBeNull();
      expect(ticket?.contact.name).toBe('Ana');
      expect(ticket?.contact.email).toBe('telegram-555@telegram.local');
      expect(ticket?.messages).toHaveLength(1);
      expect(ticket?.messages[0].body).toBe('Hello, I need help');
    });

    it('folds a follow-up message from the same chat into the still-open ticket', async () => {
      await handleTelegramUpdate(tenantId, {
        update_id: 1,
        message: { message_id: 1, chat: { id: 555 }, text: 'First', from: { id: 555, first_name: 'Ana' } },
      });
      await handleTelegramUpdate(tenantId, {
        update_id: 2,
        message: { message_id: 2, chat: { id: 555 }, text: 'Second', from: { id: 555, first_name: 'Ana' } },
      });

      const tickets = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findMany({ where: { channel: 'telegram', externalId: '555' } }));
      expect(tickets).toHaveLength(1);
      const messages = await withTenantTx(prisma, tenantId, (tx) => tx.message.findMany({ where: { ticketId: tickets[0].id }, orderBy: { createdAt: 'asc' } }));
      expect(messages.map((m) => m.body)).toEqual(['First', 'Second']);
    });

    it('starts a fresh ticket once the previous one for that chat is closed', async () => {
      await handleTelegramUpdate(tenantId, {
        update_id: 1,
        message: { message_id: 1, chat: { id: 555 }, text: 'First', from: { id: 555, first_name: 'Ana' } },
      });
      const firstTicket = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findFirstOrThrow({ where: { channel: 'telegram', externalId: '555' } }));
      const closedStatus = await withTenantTx(prisma, tenantId, (tx) => tx.ticketStatus.findFirstOrThrow({ where: { key: 'closed' } }));
      await withTenantTx(prisma, tenantId, (tx) => tx.ticket.update({ where: { id: firstTicket.id }, data: { statusId: closedStatus.id } }));

      await handleTelegramUpdate(tenantId, {
        update_id: 2,
        message: { message_id: 2, chat: { id: 555 }, text: 'New conversation', from: { id: 555, first_name: 'Ana' } },
      });

      const tickets = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findMany({ where: { channel: 'telegram', externalId: '555' } }));
      expect(tickets).toHaveLength(2);
    });

    it('ignores a non-text update (e.g. a photo) without creating anything', async () => {
      await handleTelegramUpdate(tenantId, { update_id: 1, message: { message_id: 1, chat: { id: 555 } } });
      const tickets = await withTenantTx(prisma, tenantId, (tx) => tx.ticket.findMany({ where: { channel: 'telegram' } }));
      expect(tickets).toHaveLength(0);
    });

    it('two different chats get two independent tickets', async () => {
      await handleTelegramUpdate(tenantId, {
        update_id: 1,
        message: { message_id: 1, chat: { id: 555 }, text: 'From Ana', from: { id: 555, first_name: 'Ana' } },
      });
      await handleTelegramUpdate(tenantId, {
        update_id: 2,
        message: { message_id: 2, chat: { id: 777 }, text: 'From Bo', from: { id: 777, first_name: 'Bo' } },
      });

      const tickets = await withTenantTx(prisma, tenantId, (tx) =>
        tx.ticket.findMany({ where: { channel: 'telegram' }, orderBy: { externalId: 'asc' } }),
      );
      expect(tickets).toHaveLength(2);
      expect(tickets.map((t) => t.externalId)).toEqual(['555', '777']);
    });

    // Regression: a real telegram-send job got enqueued live in dev for the
    // customer's OWN follow-up message (which would have echoed it right back
    // to them) before addMessage's shouldTelegram check excluded
    // authorType === 'CONTACT' -- see the fix's comment in tickets/service.ts.
    // Spies on the queue rather than inspecting real Redis job counts: this
    // suite runs against a real Redis, shared with whatever worker process
    // may also be live-consuming from it, so asserting on job counts directly
    // would race an already-running consumer.
    it('does not enqueue an outbound telegram-send job for the customer\'s own follow-up message', async () => {
      const addSpy = vi.spyOn(telegramSendQueue, 'add').mockResolvedValue({} as never);

      await handleTelegramUpdate(tenantId, {
        update_id: 1,
        message: { message_id: 1, chat: { id: 555 }, text: 'First', from: { id: 555, first_name: 'Ana' } },
      });
      await handleTelegramUpdate(tenantId, {
        update_id: 2,
        message: { message_id: 2, chat: { id: 555 }, text: 'Second', from: { id: 555, first_name: 'Ana' } },
      });

      expect(addSpy).not.toHaveBeenCalled();
      addSpy.mockRestore();
    });

    it('falls back to a synthesized name when Telegram gives no first/last name, only a username', async () => {
      await handleTelegramUpdate(tenantId, {
        update_id: 1,
        message: { message_id: 1, chat: { id: 999 }, text: 'hi', from: { id: 999, username: 'anon_user' } },
      });
      const ticket = await withTenantTx(prisma, tenantId, (tx) =>
        tx.ticket.findFirstOrThrow({ where: { channel: 'telegram', externalId: '999' }, include: { contact: true } }),
      );
      expect(ticket.contact.name).toBe('@anon_user');
    });
  });
});
