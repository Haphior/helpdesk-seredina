import IORedis from 'ioredis';
import {
  LIVE_CHANNEL_PATTERN,
  parseLiveEvent,
  publishLiveEvent,
  tenantIdFromLiveChannel,
  type LiveEvent,
} from '@seredina/shared';

/**
 * Live console updates (docs/adr/0053-live-updates.md): the publishing side
 * used by services after a change commits, and the in-process hub that
 * GET /events streams hang off.
 *
 * Redis pub/sub, not an in-memory emitter, because `api` runs as several
 * replicas (docs/adr/0038-multi-replica-hardening.md) and `worker` publishes
 * too: a change made on replica A or by the worker must reach a console
 * connected to replica B. Each process holds exactly ONE subscriber
 * connection (a pattern subscription over every tenant's channel) and fans
 * out in memory -- not one Redis connection per open browser tab.
 */

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// lazyConnect for the same reason as lib/queue.ts: importing this module must
// not force every test file to have a live Redis.
const publisher = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });

/** Fire-and-forget from the caller's point of view -- never throws, see publishLiveEvent. */
export function publishLive(tenantId: string, event: LiveEvent): Promise<void> {
  return publishLiveEvent(publisher, tenantId, event);
}

export interface LiveClient {
  tenantId: string;
  userId: string;
  send(event: LiveEvent): void;
  close(): void;
}

/** A browser opening many tabs is fine; an unbounded number of held-open sockets per user is not. */
export const MAX_STREAMS_PER_USER = 5;

const clientsByTenant = new Map<string, Set<LiveClient>>();
let subscriber: IORedis | null = null;
let subscribed: Promise<void> | null = null;

function deliver(tenantId: string, event: LiveEvent) {
  const clients = clientsByTenant.get(tenantId);
  if (!clients) return;
  for (const client of clients) {
    if (event.type === 'notification.created' && event.userId !== client.userId) continue;
    client.send(event);
  }
}

function ensureSubscribed(): Promise<void> {
  if (subscribed) return subscribed;
  subscriber = new IORedis(redisUrl!, { maxRetriesPerRequest: null, lazyConnect: true });
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const tenantId = tenantIdFromLiveChannel(channel);
    const event = parseLiveEvent(message);
    if (tenantId && event) deliver(tenantId, event);
  });
  subscribed = subscriber
    .psubscribe(LIVE_CHANNEL_PATTERN)
    .then(() => undefined)
    .catch((err) => {
      // Let the next connection attempt retry from scratch instead of
      // reusing a rejected promise forever.
      subscriber?.disconnect();
      subscriber = null;
      subscribed = null;
      throw err;
    });
  return subscribed;
}

/**
 * Registers a stream. Resolves once the process is subscribed to Redis (so
 * the caller can answer 503 if Redis is down) and returns the unregister
 * function. Over MAX_STREAMS_PER_USER, the user's oldest stream is closed.
 */
export async function addLiveClient(client: LiveClient): Promise<() => void> {
  await ensureSubscribed();

  let clients = clientsByTenant.get(client.tenantId);
  if (!clients) {
    clients = new Set();
    clientsByTenant.set(client.tenantId, clients);
  }
  const own = [...clients].filter((c) => c.userId === client.userId);
  if (own.length >= MAX_STREAMS_PER_USER) own[0].close(); // Set iteration order = insertion order: oldest first
  clients.add(client);

  return () => {
    const set = clientsByTenant.get(client.tenantId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) clientsByTenant.delete(client.tenantId);
  };
}

/** Test helper: how many streams a tenant has open in this process. */
export function liveClientCount(tenantId: string): number {
  return clientsByTenant.get(tenantId)?.size ?? 0;
}
