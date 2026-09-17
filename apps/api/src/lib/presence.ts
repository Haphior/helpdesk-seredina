import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// Same lazyConnect posture as lib/queue.ts, and the same reason: importing this
// module (transitively, via modules/tickets/routes.ts) must never force every test
// file to need a live Redis just to load.
const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

const PRESENCE_TTL_SECONDS = 20;

function presenceKey(tenantId: string, ticketId: string, userId: string) {
  return `presence:${tenantId}:${ticketId}:${userId}`;
}

/**
 * "Who else has this ticket open right now" (docs/adr/0019-collision-merge-bulk-actions.md)
 * is a presence signal, not a new table -- a short-poll heartbeat from the ticket
 * detail page keeps this key alive; closing the tab just lets it expire within
 * PRESENCE_TTL_SECONDS. No delivery guarantee and none needed: worst case, a
 * viewer who just left still shows as present for a few more seconds.
 */
export async function markPresence(tenantId: string, ticketId: string, userId: string): Promise<void> {
  await redis.set(presenceKey(tenantId, ticketId, userId), '1', 'EX', PRESENCE_TTL_SECONDS);
}

/**
 * SCAN, not KEYS -- safe under production load even though the real key count per
 * ticket is always tiny (a handful of agents at most). Returns userIds only; the
 * caller already has a /users list loaded to map a name, so this doesn't duplicate
 * that data or need its own DB round-trip.
 */
export async function listPresence(tenantId: string, ticketId: string, excludeUserId?: string): Promise<string[]> {
  const prefix = `presence:${tenantId}:${ticketId}:`;
  const userIds: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 50);
    cursor = next;
    for (const key of keys) {
      const userId = key.slice(prefix.length);
      if (userId !== excludeUserId) userIds.push(userId);
    }
  } while (cursor !== '0');
  return userIds;
}
