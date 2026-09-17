import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma, withTenantTx } from '@seredina/db';
import { decryptSecret } from '@seredina/shared';
import { ingestInboundEmail } from './ingest';
import { notifyUser } from '../notifications/notify';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY env var is required');
}

interface EmailChannelRow {
  id: string;
  tenantId: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPasswordEncrypted: string;
}

async function pollEmailChannel(channel: EmailChannelRow): Promise<void> {
  const password = decryptSecret(channel.imapPasswordEncrypted, ENCRYPTION_KEY!);
  const client = new ImapFlow({
    host: channel.imapHost,
    port: channel.imapPort,
    secure: channel.imapSecure,
    auth: { user: channel.imapUsername, pass: password },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Collected and flagged as a single batch AFTER the loop, not one STORE per
      // message inside it -- issuing a STORE command while a multi-message FETCH's
      // untagged responses are still streaming on the same connection hangs
      // indefinitely against at least Greenmail (found by testing against it, not
      // documented behavior); a fully-drained FETCH first, then one STORE, is safe.
      const processedUids: number[] = [];

      for await (const message of client.fetch({ seen: false }, { source: true, uid: true })) {
        if (!message.source) continue; // requested via {source: true}; absent only if imapflow failed to fetch it
        const parsed = await simpleParser(message.source, {});
        const from = parsed.from?.value[0];
        const fromAddress = from?.address ?? 'unknown@unknown.invalid';
        const references = Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : [];

        const { assigneeToNotify } = await ingestInboundEmail({
          tenantId: channel.tenantId,
          fromAddress,
          fromName: from?.name || fromAddress,
          subject: parsed.subject ?? '',
          text: parsed.text ?? '',
          messageId: parsed.messageId ?? `<generated-${channel.id}-${message.uid}@seredina.local>`,
          inReplyTo: parsed.inReplyTo ?? null,
          references,
        });

        if (assigneeToNotify) {
          await notifyUser(channel.tenantId, assigneeToNotify.userId, 'NEW_REPLY', {
            body: `New reply on #${assigneeToNotify.ticketNumber}: ${assigneeToNotify.ticketSubject}`,
            subject: `[#${assigneeToNotify.ticketNumber}] New reply: ${assigneeToNotify.ticketSubject}`,
          });
        }

        processedUids.push(message.uid);
      }

      if (processedUids.length > 0) {
        await client.messageFlagsAdd(processedUids, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  await withTenantTx(prisma, channel.tenantId, (tx) =>
    tx.emailChannel.update({ where: { id: channel.id }, data: { lastPolledAt: new Date() } }),
  );
}

/**
 * Finds every active EmailChannel across every tenant and polls each in turn. This
 * genuinely needs to cross the tenant boundary (the worker doesn't know in advance
 * which tenants to check), which the guarded Prisma client structurally can't do --
 * same shape as resolving a tenant by slug/API-key hash, see
 * docs/adr/0001-multi-tenancy-rls.md and docs/adr/0004-email-channel.md. The
 * SECURITY DEFINER function exposes only (id, tenant_id), never credentials; each
 * channel's full row (including the still-encrypted password) is then fetched
 * through the normal tenant-scoped path.
 */
export async function pollActiveEmailChannels(): Promise<void> {
  const channels = await prisma.$queryRaw<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM list_active_email_channels()
  `;

  for (const { id, tenant_id: tenantId } of channels) {
    try {
      const channel = await withTenantTx(prisma, tenantId, (tx) => tx.emailChannel.findUnique({ where: { id } }));
      if (!channel) continue; // deleted between the list and the fetch -- fine, skip it
      await pollEmailChannel(channel);
    } catch (err) {
      // One broken mailbox (bad creds, unreachable host, ...) must not stop the
      // rest of the tenants' channels from being polled this cycle.
      console.error(`[worker] failed to poll email channel ${id} (tenant ${tenantId}):`, err);
    }
  }
}
