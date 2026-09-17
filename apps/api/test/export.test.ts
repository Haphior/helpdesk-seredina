import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { exportTenantData } from '../src/modules/export/service';
import { createTicketFromApi, seedDefaultTicketStatuses } from '../src/modules/tickets/service';
import { createMacro } from '../src/modules/macros/service';
import { createWebhook } from '../src/modules/webhooks/service';
import { createApiKey } from '../src/modules/apikeys/service';
import { createEmailChannel } from '../src/modules/emailchannels/service';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Data export', () => {
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    otherTenantId = randomUUID();
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `export-${tenantId.slice(0, 8)}`, name: 'Export Test' } });
      await seedDefaultTicketStatuses(tx, tenantId);
    });
    await withTenantTx(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, slug: `other-${otherTenantId.slice(0, 8)}`, name: 'Other Tenant' } });
      await seedDefaultTicketStatuses(tx, otherTenantId);
    });

    await createTicketFromApi(tenantId, {
      subject: 'Exportable ticket',
      body: 'body',
      contactEmail: 'c@example.com',
      contactName: 'C',
    });
    await createMacro(tenantId, { name: 'Close it', actions: { setStatusId: undefined, setPriority: 'LOW' } });
    await createWebhook(tenantId, { url: 'https://example.com/hook', events: ['ticket.created'] });
    await createApiKey(tenantId, 'export test key');
    await createEmailChannel(tenantId, {
      name: 'Support inbox',
      fromAddress: 'support@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecure: true,
      imapUsername: 'support',
      imapPassword: 'imap-secret-password',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'support',
      smtpPassword: 'smtp-secret-password',
    });

    // A ticket in the OTHER tenant -- proves the export never crosses tenants.
    await createTicketFromApi(otherTenantId, {
      subject: 'Should never appear in the first export',
      body: 'body',
      contactEmail: 'other@example.com',
      contactName: 'Other',
    });
  });

  it('includes real data across multiple tables', async () => {
    const data = await exportTenantData(tenantId);
    expect(data.tenant.id).toBe(tenantId);
    expect(data.tickets.some((t) => t.subject === 'Exportable ticket')).toBe(true);
    expect(data.macros.some((m) => m.name === 'Close it')).toBe(true);
    expect(data.webhooks.some((w) => w.url === 'https://example.com/hook')).toBe(true);
    expect(data.emailChannels.some((c) => c.name === 'Support inbox')).toBe(true);
    expect(data.apiKeys.some((k) => k.name === 'export test key')).toBe(true);
  });

  it('never leaks a secret -- password hashes, hashed API keys, encrypted channel passwords, or webhook secrets', async () => {
    const data = await exportTenantData(tenantId);
    const json = JSON.stringify(data);

    expect(json).not.toContain('imap-secret-password'); // never even encrypted-and-present -- the field itself is absent
    expect(json).not.toContain('smtp-secret-password');
    expect(data.emailChannels.every((c) => !('imapPasswordEncrypted' in c) && !('smtpPasswordEncrypted' in c))).toBe(true);
    expect(data.apiKeys.every((k) => !('hashedKey' in k))).toBe(true);
    expect(data.webhooks.every((w) => !('secretEncrypted' in w))).toBe(true);
    expect(data.users.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it('excludes transient tables not meant for portability (Notification, DiscoveryJob)', async () => {
    const data = await exportTenantData(tenantId);
    expect('notifications' in data).toBe(false);
    expect('discoveryJobs' in data).toBe(false);
  });

  it('never includes another tenant\'s rows', async () => {
    const data = await exportTenantData(tenantId);
    expect(data.tickets.some((t) => t.subject.includes('never appear'))).toBe(false);
    expect(data.tickets.every((t) => t.tenantId === tenantId)).toBe(true);

    const otherData = await exportTenantData(otherTenantId);
    expect(otherData.tickets.some((t) => t.subject === 'Exportable ticket')).toBe(false);
  });
});
