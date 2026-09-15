import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { DISCOVERY_QUEUE_NAME, type DiscoveryJobPayload } from '@seredina/shared';
import { runDiscoveryJob } from './discovery/processor';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL env var is required');
}

// BullMQ's own requirement, not a stylistic choice: it manages retries itself and
// will throw if the underlying ioredis client also retries commands on its own.
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<DiscoveryJobPayload>(
  DISCOVERY_QUEUE_NAME,
  async (job) => {
    const { tenantId, discoveryJobId, cidrRange } = job.data;
    await runDiscoveryJob(tenantId, discoveryJobId, cidrRange);
  },
  { connection, concurrency: 1 }, // one scan at a time -- each already fans out internally (see SCAN_CONCURRENCY)
);

worker.on('failed', (job, err) => {
  console.error(`[worker] discovery job ${job?.id} failed:`, err);
});

console.log('[worker] listening on queue:', DISCOVERY_QUEUE_NAME);
