import { randomBytes } from 'node:crypto';
import { prisma, withTenantTx } from '@seredina/db';
import { sha256Hex } from '../../lib/hash';

const KEY_PREFIX = 'sk_';

export interface CreatedApiKey {
  id: string;
  name: string;
  /** Returned once, at creation time only -- never retrievable again (only the hash is stored). */
  key: string;
}

export async function createApiKey(tenantId: string, name: string): Promise<CreatedApiKey> {
  const key = KEY_PREFIX + randomBytes(32).toString('base64url');
  const hashedKey = sha256Hex(key);

  return withTenantTx(prisma, tenantId, async (tx) => {
    const apiKey = await tx.apiKey.create({ data: { tenantId, name, hashedKey } });
    return { id: apiKey.id, name: apiKey.name, key };
  });
}

export async function listApiKeys(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) =>
    tx.apiKey.findMany({
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
}
