import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { MAX_ATTACHMENT_SIZE_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from '@seredina/shared';
import { ingestInboundEmail, selectInboundAttachments, type InboundAttachment } from '../../worker/src/email/ingest';
import { pickSendChannel } from '../../worker/src/email/transport';
import { redisLock } from '../../worker/src/lib/lock';
import { createEmailChannel } from '../src/modules/emailchannels/service';
import { seedDefaultTicketStatuses } from '../src/modules/tickets/service';

const hasDb = Boolean(process.env.DATABASE_URL);

function file(name: string, bytes: number, inline = false): InboundAttachment {
  return { filename: name, mimeType: 'application/octet-stream', data: Buffer.alloc(bytes, 1), inline };
}

describe('selectInboundAttachments', () => {
  it('keeps real attachments before inline images and names what it drops', () => {
    const { kept, skippedNote } = selectInboundAttachments([
      file('logo1.png', 10, true),
      file('logo2.png', 10, true),
      file('report.pdf', 100),
      file('huge.zip', MAX_ATTACHMENT_SIZE_BYTES + 1),
      file('a.txt', 1),
      file('b.txt', 1),
      file('c.txt', 1),
      file('d.txt', 1),
    ]);
    expect(kept.map((a) => a.filename)).toEqual(['report.pdf', 'a.txt', 'b.txt', 'c.txt', 'd.txt']);
    expect(kept).toHaveLength(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(skippedNote).toContain('huge.zip');
    // Inline images past the cap are signature noise, not worth a note.
    expect(skippedNote).not.toContain('logo');
  });

  it('adds no note when everything fits', () => {
    expect(selectInboundAttachments([file('x.pdf', 5)]).skippedNote).toBeNull();
  });
});

describe('pickSendChannel', () => {
  const channels = [
    { id: 'a', isActive: true, connectionStatus: 'connected' },
    { id: 'b', isActive: true, connectionStatus: 'connected' },
    { id: 'c', isActive: true, connectionStatus: 'needs_reconnect' },
  ];
  it('prefers the channel the ticket arrived on', () => {
    expect(pickSendChannel(channels, 'b')?.id).toBe('b');
  });
  it('falls back to the first connected channel', () => {
    expect(pickSendChannel(channels, 'c')?.id).toBe('a');
    expect(pickSendChannel(channels, null)?.id).toBe('a');
    expect(pickSendChannel([channels[2]], null)).toBeNull();
  });
});

describe.skipIf(!process.env.REDIS_URL)('email poll lock', () => {
  it('lets only one caller hold a mailbox at a time, and frees it afterwards', async () => {
    const key = `seredina:test-lock:${randomUUID()}`;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const runs: string[] = [];

    const first = redisLock.runExclusive(key, 10_000, async () => {
      runs.push('first');
      await held;
    });
    await new Promise((r) => setTimeout(r, 50));
    const second = await redisLock.runExclusive(key, 10_000, async () => {
      runs.push('second');
    });
    expect(second).toBe(false);

    release();
    expect(await first).toBe(true);
    expect(await redisLock.runExclusive(key, 10_000, async () => void runs.push('third'))).toBe(true);
    expect(runs).toEqual(['first', 'third']);
  });
});

describe.skipIf(!hasDb)('inbound email ingestion', () => {
  let tenantId: string;
  let channelId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `ingest-${tenantId.slice(0, 8)}`, name: 'Ingest' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
    const channel = await createEmailChannel(tenantId, {
      name: 'Support',
      fromAddress: 'support@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecure: true,
      imapUsername: 'support',
      imapPassword: 'x',
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: 'support',
      smtpPassword: 'x',
    });
    channelId = channel.id;
  });

  it('stores attachments on the message and remembers the mailbox', async () => {
    const { ticketId } = await ingestInboundEmail({
      tenantId,
      fromAddress: 'customer@example.com',
      fromName: 'Customer',
      subject: 'Printer broken',
      text: 'See the screenshot',
      messageId: `<${randomUUID()}@mail.example.com>`,
      inReplyTo: null,
      references: [],
      emailChannelId: channelId,
      attachments: [
        { filename: 'screen.png', mimeType: 'image/png', data: Buffer.from('png-bytes'), inline: true },
        { filename: 'too-big.iso', mimeType: 'application/octet-stream', data: Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1), inline: false },
      ],
    });

    const ticket = await withTenantTx(prisma, tenantId, (tx) =>
      tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { messages: { include: { attachments: true } } } }),
    );
    expect(ticket.emailChannelId).toBe(channelId);
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0].attachments.map((a) => a.filename)).toEqual(['screen.png']);
    expect(ticket.messages[0].attachments[0].data.toString()).toBe('png-bytes');
    expect(ticket.messages[0].body).toContain('too-big.iso');
  });

  it('ignores the same Message-ID a second time', async () => {
    const email = {
      tenantId,
      fromAddress: 'dup@example.com',
      fromName: 'Dup',
      subject: 'Once only',
      text: 'hello',
      messageId: `<${randomUUID()}@mail.example.com>`,
      inReplyTo: null,
      references: [],
      emailChannelId: channelId,
    };
    const first = await ingestInboundEmail(email);
    const second = await ingestInboundEmail(email);
    expect(second.ticketId).toBe(first.ticketId);
    const count = await withTenantTx(prisma, tenantId, (tx) => tx.message.count({ where: { externalId: email.messageId } }));
    expect(count).toBe(1);
  });
});
