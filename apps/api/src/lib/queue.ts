import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { DISCOVERY_QUEUE_NAME, type DiscoveryJobPayload } from '@seredina/shared';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// BullMQ's own requirement, not a stylistic choice -- see apps/worker/src/index.ts.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

export const discoveryQueue = new Queue<DiscoveryJobPayload>(DISCOVERY_QUEUE_NAME, { connection });
