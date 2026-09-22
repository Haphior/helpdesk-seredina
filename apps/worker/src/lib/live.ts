import IORedis from 'ioredis';
import { publishLiveEvent, type LiveEvent } from '@seredina/shared';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// Its own connection, separate from the BullMQ ones in queue.ts/index.ts --
// same one-client-per-role reasoning as there.
const publisher = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });

/**
 * The worker-side twin of apps/api/src/lib/live.ts's publishLive: tells open
 * consoles about changes the worker commits (inbound email, SLA breaches,
 * escalation notes, notifications). Never throws -- see publishLiveEvent.
 * docs/adr/0053-live-updates.md.
 */
export function publishLive(tenantId: string, event: LiveEvent): Promise<void> {
  return publishLiveEvent(publisher, tenantId, event);
}
