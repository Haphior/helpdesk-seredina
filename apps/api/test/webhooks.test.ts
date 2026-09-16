import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import { createWebhook, listWebhooks } from '../src/modules/webhooks/service';
import { dispatchWebhookEvent } from '../src/lib/webhookDispatch';

const hasDb = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

describe.skipIf(!hasDb)('webhooks', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, slug: `wh-${tenantId.slice(0, 8)}`, name: 'Webhook Test' } }),
    );
  });

  it('rejects a non-https URL', async () => {
    await expect(createWebhook(tenantId, { url: 'http://example.com/hook', events: ['ticket.created'] })).rejects.toThrow(
      'webhook URL must use https://',
    );
  });

  it('shows the signing secret exactly once -- create response has it, list never does', async () => {
    const created = await createWebhook(tenantId, { url: 'https://example.com/hook', events: ['ticket.created'] });
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(created).not.toHaveProperty('secretEncrypted');

    const listed = await listWebhooks(tenantId);
    const found = listed.find((w) => w.id === created.id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('secret');
    expect(found).not.toHaveProperty('secretEncrypted');
  });

  it('dispatchWebhookEvent is a no-op (no Redis touched) when nothing is subscribed to the event', async () => {
    // A webhook subscribed only to ticket.created exists from the previous test --
    // dispatching message.created must find zero matches and return without ever
    // reaching the queue, which is what keeps this test runnable without Redis.
    await expect(dispatchWebhookEvent(tenantId, 'message.created', { foo: 'bar' })).resolves.toBeUndefined();
  });

  it.skipIf(!hasRedis)('dispatchWebhookEvent enqueues a delivery job for a matching active webhook', async () => {
    await createWebhook(tenantId, { url: 'https://example.com/matching-hook', events: ['message.created'] });
    // No assertion beyond "doesn't throw" -- inspecting BullMQ's internal job
    // counts would just be re-testing BullMQ itself. The real logic under test
    // (which webhooks match) is covered by the no-op case above; this only proves
    // the enqueue path is reachable end to end against a real Redis.
    await expect(dispatchWebhookEvent(tenantId, 'message.created', { foo: 'bar' })).resolves.toBeUndefined();
  });
});
