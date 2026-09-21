import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createWebhook, rotateWebhookSecret, updateWebhook } from '../src/modules/webhooks/service';

/**
 * Slack/Teams "chat" webhooks (docs/adr/0048-chat-notifications.md): a tenant
 * brings their own Incoming Webhook / Workflows URL from their own Slack/Teams
 * workspace, no OAuth app or secret on this project's side. The generic
 * webhook behavior (https-only, secret shown once, RLS scoping) is already
 * covered by webhooks.test.ts; these tests cover what's actually new: no
 * secret for chat kinds, the curated event subset, and kind's immutability.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('Chat (Slack/Teams) webhooks', () => {
  let tenantId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `chatwh-${tenantId.slice(0, 8)}`, name: 'Chat Webhook Test' } }),
    );
  });

  it('a slack-kind webhook has no signing secret', async () => {
    const created = await createWebhook(tenantId, {
      url: 'https://hooks.slack.com/services/T00/B00/xxxx',
      events: ['ticket.created'],
      kind: 'slack',
    });
    expect(created.secret).toBeNull();
    expect(created.kind).toBe('slack');
  });

  it('a teams-kind webhook has no signing secret', async () => {
    const created = await createWebhook(tenantId, {
      url: 'https://example.webhook.office.com/webhookb2/xxxx',
      events: ['sla.first_response_breached'],
      kind: 'teams',
    });
    expect(created.secret).toBeNull();
    expect(created.kind).toBe('teams');
  });

  it('a generic webhook (default kind) still gets a real secret, unaffected by the new field', async () => {
    const created = await createWebhook(tenantId, { url: 'https://example.com/hook', events: ['ticket.created'] });
    expect(created.kind).toBe('generic');
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects ticket.updated for a slack/teams webhook -- outside the curated chat event set', async () => {
    await expect(
      createWebhook(tenantId, { url: 'https://hooks.slack.com/services/T00/B00/xxxx', events: ['ticket.updated'], kind: 'slack' }),
    ).rejects.toThrow('slack webhooks only support these events');
  });

  it('rejects message.created for a slack/teams webhook -- raw message bodies could leak a private note or customer message', async () => {
    await expect(
      createWebhook(tenantId, { url: 'https://hooks.slack.com/services/T00/B00/xxxx', events: ['message.created'], kind: 'teams' }),
    ).rejects.toThrow('teams webhooks only support these events');
  });

  it('accepts all three curated chat events together', async () => {
    const created = await createWebhook(tenantId, {
      url: 'https://hooks.slack.com/services/T00/B00/xxxx',
      events: ['ticket.created', 'sla.first_response_breached', 'sla.resolution_breached'],
      kind: 'slack',
    });
    expect(created.events).toHaveLength(3);
  });

  it('updating a slack webhook still enforces the curated event set against its own stored kind', async () => {
    const created = await createWebhook(tenantId, {
      url: 'https://hooks.slack.com/services/T00/B00/xxxx',
      events: ['ticket.created'],
      kind: 'slack',
    });
    await expect(updateWebhook(tenantId, created.id, { events: ['message.created'] })).rejects.toThrow(
      'slack webhooks only support these events',
    );
  });

  it('updating a generic webhook is unaffected -- all 5 events still allowed', async () => {
    const created = await createWebhook(tenantId, { url: 'https://example.com/hook', events: ['ticket.created'] });
    const updated = await updateWebhook(tenantId, created.id, { events: ['ticket.updated', 'message.created'] });
    expect(updated.events).toEqual(['ticket.updated', 'message.created']);
  });

  it('rejects rotating the secret on a slack/teams webhook -- there is no secret', async () => {
    const created = await createWebhook(tenantId, {
      url: 'https://hooks.slack.com/services/T00/B00/xxxx',
      events: ['ticket.created'],
      kind: 'slack',
    });
    await expect(rotateWebhookSecret(tenantId, created.id)).rejects.toThrow('slack webhooks have no signing secret to rotate');
  });

  it('rotating the secret on a generic webhook still works', async () => {
    const created = await createWebhook(tenantId, { url: 'https://example.com/hook', events: ['ticket.created'] });
    const rotated = await rotateWebhookSecret(tenantId, created.id);
    expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.secret).not.toBe(created.secret);
  });
});
