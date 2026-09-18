import { resolveTenantIdByApiKeyHash } from '@seredina/db';
import { sha256Hex } from '@seredina/shared';

/** Shared by both transports -- resolves an ApiKey string to a tenantId, or null if it doesn't match any known key. */
export async function resolveTenantIdFromApiKey(apiKey: string): Promise<string | null> {
  return resolveTenantIdByApiKeyHash(sha256Hex(apiKey));
}
