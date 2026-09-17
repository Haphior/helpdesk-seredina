import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { listPresence, markPresence } from '../src/lib/presence';

const hasRedis = Boolean(process.env.REDIS_URL);

describe.skipIf(!hasRedis)('Ticket presence (collision detection)', () => {
  it('a marked viewer shows up in the list, excluding the caller themself', async () => {
    const tenantId = randomUUID();
    const ticketId = randomUUID();
    const viewerA = randomUUID();
    const viewerB = randomUUID();

    await markPresence(tenantId, ticketId, viewerA);
    await markPresence(tenantId, ticketId, viewerB);

    const seenByB = await listPresence(tenantId, ticketId, viewerB);
    expect(seenByB).toEqual([viewerA]);

    const seenByNeither = await listPresence(tenantId, ticketId);
    expect(seenByNeither.sort()).toEqual([viewerA, viewerB].sort());
  });

  it('presence is scoped per ticket and per tenant -- unrelated tickets never see each other', async () => {
    const tenantId = randomUUID();
    const ticketA = randomUUID();
    const ticketB = randomUUID();
    const viewer = randomUUID();

    await markPresence(tenantId, ticketA, viewer);
    expect(await listPresence(tenantId, ticketB)).toEqual([]);
  });

  it('an unrelated tenant with the same ticket id never sees the other tenant\'s viewer', async () => {
    const ticketId = randomUUID();
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const viewer = randomUUID();

    await markPresence(tenantA, ticketId, viewer);
    expect(await listPresence(tenantB, ticketId)).toEqual([]);
  });
});
