// Shared between apps/api (producer) and apps/worker (consumer) so the queue name
// and job payload shape can't drift between the two processes.
export const DISCOVERY_QUEUE_NAME = 'discovery';

export interface DiscoveryJobPayload {
  tenantId: string;
  discoveryJobId: string;
  cidrRange: string;
}
